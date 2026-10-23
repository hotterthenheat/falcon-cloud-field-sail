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

import { crossDay, floorPackaged, notABet, SPREAD_LEG_PCT } from '../../data/flowBook';

const notABetNoCross = (r: { floorPct: number; multiPct: number }) => floorPackaged(r) || r.multiPct >= SPREAD_LEG_PCT;
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
  clipFor?: (row: BookContract) => { size: number; fill: number; side: 'ASK' | 'BID'; time: string; multi?: boolean } | undefined;
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
  /* A DAY-BOOK ROW OPENS THE CONTRACT'S DAY (audit round 4: the Screener's NVDA 220C opened as one after-hours $18 print):
     the day's premium, volume and lean, anchored on its latest regular-session print — the fill, the quote and the time
     shown as that print's. A host's own clip (a flow alert's exact print, the Tracker's mark) stays that print. */
  const print = useMemo(() => {
    if (!row) return null;
    const own = clipFor?.(row);
    if (own) return { ...bookRowToPrint(row, own), occ: row.optionSymbol };
    const day = bookRowToPrint(row);
    return {
      ...day,
      occ: row.optionSymbol,
      fill: last?.fill ?? day.fill,
      bid: last && last.bid > 0 ? last.bid : day.bid,
      ask: last && last.ask > 0 ? last.ask : day.ask,
      time: last?.time ?? day.time,
      fillPos: last && last.ask > last.bid && last.bid > 0 ? Math.min(1, Math.max(0, (last.fill - last.bid) / (last.ask - last.bid))) : 0.5,
      /* the day is not a leg of anything — unless half or more of it traded as legs of multi-leg orders (audit round 8,
         flowBook notABet): then its side is the packages', and the card gives it no read */
      legs: notABet(row) && !crossDay(row) ? 2 : 1,
      /* a day of crosses has no side either (audit round 9) — said as a cross, not as spread legs */
      cross: crossDay(row) && !notABetNoCross(row) ? true : day.cross,
      strat: '—' as const,
      theta: last?.theta ?? day.theta,
      dayCard: { last: last ? { fill: last.fill, size: last.size, time: last.time, side: last.side, volume: last.volume ?? 0 } : null, session: last?.extended ? 'after hours' : 'regular session' },
    };
  }, [row, clipFor, last]);

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
