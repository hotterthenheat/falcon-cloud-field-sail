/* The day's change, one way: after the close the feed's prev_close is today's close, so the after-hours move read as the day's.
   This prints the regular session's change, the extended move beside it in words, and a zero in the neutral ink. */
import { changeInk, dayMoveWords, peekDayMove, useBookRev, type DayMove } from '../../data/uwBook';
import type { MarketSnapshot } from '../../types/market';

/** The day's move off a live snapshot (its regular change and the move outside the session) */
export const dayMoveOfSnapshot = (s: MarketSnapshot): DayMove => ({
  dayPct: s.dayMove && !s.dayMove.known ? null : s.changePercent,
  extPct: s.dayMove?.extPct ?? null,
  phase: s.dayMove?.phase ?? 'regular',
});

interface Props {
  /** Read from the book by name… */
  ticker?: string;
  /** …or from a snapshot in hand */
  snapshot?: MarketSnapshot | null;
  /** Drop the after-hours / pre-market figure (a tight cell); it stays in the hover */
  short?: boolean;
  className?: string;
  extClassName?: string;
}

const DayMoveText = ({ ticker, snapshot, short = false, className = 'text-t11', extClassName = 'text-textMuted' }: Props) => {
  useBookRev();
  const move = snapshot?.liveBook ? dayMoveOfSnapshot(snapshot) : ticker ? peekDayMove(ticker) : snapshot ? { dayPct: snapshot.changePercent, extPct: null, phase: 'regular' as const } : null;
  const w = dayMoveWords(move);
  if (!w || !move) return null;
  const main = move.dayPct;
  return (
    <span className={`inline-flex items-baseline gap-1.5 font-mono tnum whitespace-nowrap ${className}`} title={w.title} data-day-move>
      <span style={{ color: changeInk(main) }}>{w.main}</span>
      {w.when && <span className={extClassName}>{w.when}</span>}
      {!short && w.ext && <span className={extClassName}>· {w.ext}</span>}
    </span>
  );
};

export default DayMoveText;
