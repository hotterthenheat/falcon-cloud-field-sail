/* Whether the notification center and the help sheet are open: one flag each, flipped by whatever opens them (the "?"
   key, the menu, the palette, the footer's doors, /notifications and /help) and read by the sheets in AppShell. The
   alerts drawer's grammar (data/alertsDrawer.ts). */

import { useSyncExternalStore } from 'react';

const flag = () => {
  let open = false;
  const subs = new Set<() => void>();
  const set = (next: boolean) => {
    if (open === next) return;
    open = next;
    subs.forEach(fn => fn());
  };
  const subscribe = (fn: () => void) => {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  };
  const get = () => open;
  return { open: () => set(true), close: () => set(false), toggle: () => set(!open), get, subscribe };
};

const notices = flag();
const help = flag();

export const openNotices = notices.open;
export const closeNotices = notices.close;
export const toggleNotices = notices.toggle;
export const useNoticesOpen = (): boolean => useSyncExternalStore(notices.subscribe, notices.get, notices.get);

export const openHelp = help.open;
export const closeHelp = help.close;
export const toggleHelp = help.toggle;
export const useHelpOpen = (): boolean => useSyncExternalStore(help.subscribe, help.get, help.get);
