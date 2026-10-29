/* The Map's replay rewinds the boxes, not the shell head: the desk says which moment it replays and the head wears it as a tag.
   One word, re-rendering only the head. */

import { useSyncExternalStore } from 'react';

let label: string | null = null;
const subs = new Set<() => void>();

/** "Oct 12 · 09:32" while a replay runs, null when live */
export const setReplayLabel = (next: string | null) => {
  if (next === label) return;
  label = next;
  subs.forEach(fn => fn());
};

export const useReplayLabel = (): string | null =>
  useSyncExternalStore(
    fn => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    () => label
  );
