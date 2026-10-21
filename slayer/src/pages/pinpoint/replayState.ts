/*
==================================================
  SLAYER TERMINAL - THE REPLAY, SAID IN THE HEAD
  (pages/pinpoint/replayState.ts)

  The Map's replay rewinds the boxes under the band,
  not the shell head over them (the Pinpoint audit's
  M8, 2026-10-13: a reader scrolled past the band
  could not tell the boxes were historical and the
  facts up top were not). The desk says which moment
  it is replaying; the shell wears it as a tag and
  marks its own facts live. One word, no re-render of
  anything but the head.
==================================================
*/

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
