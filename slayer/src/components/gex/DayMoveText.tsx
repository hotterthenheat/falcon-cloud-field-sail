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

/** The same move read at another print of the same name: the closes it is measured from are recovered off the
    snapshot's own price (in the session the base of the day's change; outside it the regular close of the extended move) */
function atPrice(m: DayMove, at: number, price: number): DayMove {
  if (!(at > 0) || !(price > 0) || Math.abs(price - at) < 0.005) return m;
  if (m.phase === 'regular') {
    if (m.dayPct == null || !Number.isFinite(m.dayPct)) return m;
    const base = at / (1 + m.dayPct / 100);
    return { ...m, dayPct: (price / base - 1) * 100 };
  }
  if (m.extPct == null || !Number.isFinite(m.extPct)) return m;
  const close = at / (1 + m.extPct / 100);
  return { ...m, extPct: (price / close - 1) * 100 };
}

interface Props {
  /** Read from the book by name… */
  ticker?: string;
  /** …or from a snapshot in hand */
  snapshot?: MarketSnapshot | null;
  /** Drop the after-hours / pre-market figure (a tight cell); it stays in the hover */
  short?: boolean;
  /** The price printed beside it, when it is not the snapshot's own (the terminal's last trade): the move is re-read
      against the same closes, so the row never says 692.69 beside a move computed off 692.74 */
  price?: number | null;
  className?: string;
  extClassName?: string;
}

const DayMoveText = ({ ticker, snapshot, short = false, price = null, className = 'text-t11', extClassName = 'text-textMuted' }: Props) => {
  useBookRev();
  const move0 = snapshot?.liveBook ? dayMoveOfSnapshot(snapshot) : ticker ? peekDayMove(ticker) : snapshot ? { dayPct: snapshot.changePercent, extPct: null, phase: 'regular' as const } : null;
  const move = move0 && snapshot && price != null ? atPrice(move0, snapshot.spot, price) : move0;
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
