/*
==================================================
  SLAYER TERMINAL - THE DAY'S CHANGE, ONE WAY
  (components/gex/DayMoveText.tsx)

  The second re-audit (2026-10-22): after the close the vendor's stock-state is the post-market bar and its prev_close
  is today's regular close, so the Map head, the sidebar chip, the Board and Compare printed the after-hours move as
  the day's (SPY −0.00% on a −1.18% day, AAPL −0.06% on +1.23%). This prints the regular session's change, the move
  outside the session beside it in its own words ("after hours +0.05%", "pre-market −0.4%"), and a zero change in the
  neutral ink — never green (the retail test: "+0.00%" in green).
==================================================
*/
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

const DayMoveText = ({ ticker, snapshot, short = false, className = 'text-[11px]', extClassName = 'text-textMuted' }: Props) => {
  useBookRev();
  const move = snapshot?.liveBook ? dayMoveOfSnapshot(snapshot) : ticker ? peekDayMove(ticker) : snapshot ? { dayPct: snapshot.changePercent, extPct: null, phase: 'regular' as const } : null;
  const w = dayMoveWords(move);
  if (!w || !move) return null;
  const main = move.dayPct;
  return (
    <span className={`inline-flex items-baseline gap-1.5 font-mono tnum whitespace-nowrap ${className}`} title={w.title} data-day-move>
      <span style={{ color: changeInk(main) }}>{w.main}</span>
      {!short && w.ext && <span className={extClassName}>· {w.ext}</span>}
    </span>
  );
};

export default DayMoveText;
