import { useCallback, useState } from 'react';

/*
==================================================
  SLAYER TERMINAL - A BOX'S FOLD (data/boxFold.ts)

  Every box on the Map folds to its head and is remembered folded on this
  machine (idea 6, 2026-10-13 — the tape did; someone who lives on the
  matrix and the report can now fold the rest).
==================================================
*/

const keyOf = (box: string) => `slayer_map_fold_${box}`;

export function useBoxFold(box: string): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(keyOf(box)) !== 'shut';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    setOpen(v => {
      try {
        localStorage.setItem(keyOf(box), v ? 'shut' : 'open');
      } catch {
        /* storage off */
      }
      return !v;
    });
  }, [box]);
  return [open, toggle];
}
