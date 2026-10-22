/*
==================================================
  SLAYER TERMINAL - BOOK DRILL (Trace)
  One card for a contract, EVERYWHERE (Noah,
  2026-08-30: "should they not open up this type
  of card that we currently have on our options
  tape and not the rest of them?").

  Mounts the Live Tape's full PrintDrilldown for
  any day-book row: the row speaks as its latest
  print (data/tape bookRowToPrint) — the
  contract's real last trade off the vendor — and
  ↑/↓ steps through the host page's table order.
  No simulator snapshot and no seeded grade: the
  card reads the vendor's rows only.
==================================================
*/

import { useMemo } from 'react';
import { useContractLast } from '../../data/traceLive';
import PrintDrilldown from './PrintDrilldown';
import { bookRowToPrint } from '../../data/tape';
import { contractKey, useWatch, watchContract } from '../../context/WatchContext';
import type { BookContract } from '../../types/trace';

interface BookDrillProps {
  /** The page's visible rows, in table order — stepping walks this list */
  list: BookContract[];
  /** Key of the open row, null = closed */
  openKey: string | null;
  onOpen: (key: string | null) => void;
  /** Anchor-print override per row — Watchers hands in the exact clip */
  clipFor?: (row: BookContract) => { size: number; fill: number; side: 'ASK' | 'BID'; time: string } | undefined;
  /** The host's hold tick (kept for the hosts; the card reads the vendor itself) */
  tick?: unknown;
}

const BookDrill = ({ list, openKey, onOpen, clipFor }: BookDrillProps) => {
  /* The card's bookmark is the CONTRACT's (2026-09-03) — the same star the
     row wears, the same store the Tracker reads. */
  const { isWatched, toggle } = useWatch();

  const idx = openKey === null ? -1 : list.findIndex(r => r.key === openKey);
  const row = idx >= 0 ? list[idx] : null;

  /* The anchor is a REAL print: the host's exact clip (a flow alert's), else the contract's own last trade off the
     vendor — never an invented one (data/tape bookRowToPrint) */
  const last = useContractLast(row && !clipFor?.(row) ? row.optionSymbol : null).rows;
  const print = useMemo(() => (row ? { ...bookRowToPrint(row, clipFor?.(row) ?? last ?? undefined), occ: row.optionSymbol } : null), [row, clipFor, last]);

  return (
    <PrintDrilldown
      print={print}
      onClose={() => onOpen(null)}
      isMarked={row ? isWatched(contractKey(row)) : false}
      onToggleMark={() => row && toggle(watchContract(row, 'card'))}
      onStep={dir => {
        const next = list[idx + dir];
        if (next) onOpen(next.key);
      }}
      hasPrev={idx > 0}
      hasNext={idx >= 0 && idx < list.length - 1}
    />
  );
};

export default BookDrill;
