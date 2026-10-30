/* The contract card for any day-book row: the row speaks as its day, anchored on the contract's real last trade (or the
   host's exact clip); ↑/↓ steps through the host's table order. */

import { useMemo } from 'react';
import { crossDay, floorPackaged, notABet, SPREAD_LEG_PCT } from '../../data/flowBook';
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
  /** The exact print a host opened the row from (a flow alert's, a Tracker mark's) */
  clipFor?: (row: BookContract) => { size: number; fill: number; side: 'ASK' | 'BID' | 'MID'; time: string; bid?: number; ask?: number; premium?: number; multi?: boolean; sweep?: boolean; extended?: boolean } | undefined;
}

const BookDrill = ({ list, openKey, onOpen, clipFor }: BookDrillProps) => {
  const { isWatched, toggle } = useWatch();
  const idx = openKey === null ? -1 : list.findIndex(r => r.key === openKey);
  const row = idx >= 0 ? list[idx] : null;
  const last = useContractLast(row && !clipFor?.(row) ? row.optionSymbol : null).rows;
  const print = useMemo(() => {
    if (!row) return null;
    const own = clipFor?.(row);
    if (own) return { ...bookRowToPrint(row, own), occ: row.optionSymbol };
    const day = bookRowToPrint(row);
    /* a day of spread legs or crosses has no side of its own: the card gives it no read */
    const legsDay = notABet(row) && !crossDay(row);
    const crossOnly = crossDay(row) && !(floorPackaged(row) || row.multiPct >= SPREAD_LEG_PCT);
    return {
      ...day,
      occ: row.optionSymbol,
      fill: last?.fill ?? day.fill,
      bid: last && last.bid > 0 ? last.bid : day.bid,
      ask: last && last.ask > 0 ? last.ask : day.ask,
      time: last?.time ?? day.time,
      fillPos: last && last.ask > last.bid && last.bid > 0 ? Math.min(1, Math.max(0, (last.fill - last.bid) / (last.ask - last.bid))) : 0.5,
      legs: legsDay ? 2 : 1,
      cross: crossOnly ? true : day.cross,
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
