/*
  New York's clock as an AheadClock, read every 15 seconds, for the desk's panels.
*/

import { useEffect, useMemo, useState } from 'react';
import { aheadClock, type AheadClock } from '../../data/ahead';
import { readSessionClock } from '../../data/moc';

export function useDeskClock(): AheadClock {
  const [raw, setRaw] = useState(() => readSessionClock());
  useEffect(() => {
    const id = globalThis.setInterval(() => setRaw(readSessionClock()), 15_000);
    return () => globalThis.clearInterval(id);
  }, []);
  return useMemo(() => aheadClock(raw), [raw]);
}

