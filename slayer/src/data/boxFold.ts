import { useCallback, useState } from 'react';

/* Every box on the Map folds to its head, remembered on this machine. */

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
