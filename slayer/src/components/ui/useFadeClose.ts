import { useCallback, useState } from 'react';

/** Two-phase close: a 200 ms opacity fade, then a timer closes (never an animation end, so a close cannot wedge).
    Pair with `transition-opacity duration-200` and opacity only (a transform would trap fixed layers inside). */
export function useFadeClose(onClose: () => void, ms = 200) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(prev => {
      if (!prev) {
        window.setTimeout(() => {
          onClose();
          setClosing(false);
        }, ms);
      }
      return true;
    });
  }, [onClose, ms]);
  return { closing, close };
}
