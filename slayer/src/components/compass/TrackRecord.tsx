/* The track record at the head of the Blotter: calls, wins and losses after fees, the hit rate, the average return,
   the P&L after fees and the worst trade, overall, by book and by the session the call was made in, for today, this
   week or every recorded session. Every figure is data/compassTrack.ts over the same rows the grid lists. */

import { useMemo, useState } from 'react';
import type { Signal } from '../../data/compassLedger';
import { trackRecord, type TrackLine } from '../../data/compassTrack';
import { BOOK_NAME, SESSION_WORD } from '../../data/compassParams';
import FilterTabs from '../ui/FilterTabs';

type Scope = 'today' | 'week' | 'all';
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday of a session date's week (YYYY-MM-DD). */
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
};

const money = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`;
const ink = (v: number | null) => (v == null || v === 0 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

const Row = ({ label, line, strong, testId }: { label: string; line: TrackLine; strong?: boolean; testId: string }) => (
  <tr className={`border-b border-borderSubtle/40 ${strong ? 'text-textPrimary font-semibold' : 'text-textSecondary'}`} data-track-row={testId}>
    <td className="py-1 pr-3 whitespace-nowrap">{label}</td>
    <td className="py-1 text-right tnum" data-track="calls">{line.calls}</td>
    <td className="py-1 text-right tnum whitespace-nowrap" data-track="won-lost"><span className="text-bull">{line.won}</span> · <span className="text-bear">{line.lost}</span>{line.open + line.unavailable ? <span className="text-textMuted"> · {line.open + line.unavailable} open</span> : null}</td>
    <td className="py-1 text-right tnum" data-track="hit">{line.hitRate == null ? '—' : `${(line.hitRate * 100).toFixed(0)}%`}</td>
    <td className={`py-1 text-right tnum max-sm:hidden ${ink(line.avgRet)}`} data-track="avg">{line.avgRet == null ? '—' : `${line.avgRet > 0 ? '+' : ''}${line.avgRet.toFixed(1)}%`}</td>
    <td className={`py-1 text-right tnum whitespace-nowrap ${ink(line.closed ? line.pnl : null)}`} data-track="pnl">{line.closed ? money(line.pnl) : '—'}</td>
    <td className="py-1 pl-3 text-right tnum max-md:hidden whitespace-nowrap" data-track="worst">{line.worst ? <span><span className="text-textMuted">{line.worst.contract}</span> <span className={ink(line.worst.pnl)}>{money(line.worst.pnl)}</span></span> : '—'}</td>
  </tr>
);

const TrackRecord = ({ today, recent, all }: { today: string; recent: readonly Signal[]; all: readonly Signal[] | null }) => {
  const [scope, setScope] = useState<Scope>('week');
  /* the week: this session's, or (a weekend, a new week with no call yet) the week of the newest call */
  const weekOf = useMemo(() => {
    const monday = mondayOf(today);
    if (recent.some(s => sessionDay(s) >= monday)) return monday;
    const newest = recent.reduce((m, s) => (sessionDay(s) > m ? sessionDay(s) : m), '');
    return newest ? mondayOf(newest) : monday;
  }, [today, recent]);
  const thisWeek = weekOf === mondayOf(today);
  const rows = useMemo(() => {
    const pool = scope === 'all' ? all ?? recent : recent;
    if (scope === 'today') return pool.filter(s => sessionDay(s) === today);
    if (scope === 'week') {
      const friday = new Date(new Date(`${weekOf}T12:00:00Z`).getTime() + 4 * 86_400_000).toISOString().slice(0, 10);
      return pool.filter(s => sessionDay(s) >= weekOf && sessionDay(s) <= friday);
    }
    return [...pool];
  }, [scope, today, recent, all, weekOf]);
  const weekLabel = thisWeek ? 'This week' : `Week of ${SHORT_MONTHS[Number(weekOf.slice(5, 7)) - 1]} ${Number(weekOf.slice(8, 10))}`;
  const tr = useMemo(() => trackRecord(rows as Signal[]), [rows]);
  const sessions = (['overnight', 'pre', 'regular'] as const).filter(k => tr.bySession[k].calls > 0 || k === 'regular');
  return (
    <div className="border-t border-borderSubtle px-5 py-3" data-track-record={scope}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">Track record</span>
        <FilterTabs
          value={scope}
          onChange={setScope}
          options={[{ value: 'today', label: 'Today' }, { value: 'week', label: weekLabel }, { value: 'all', label: 'All recorded' }]}
          ariaLabel="Track record span"
          size="sm"
        />
        <span className="font-mono text-t10 text-textMuted">Per contract, after fees. Closed calls only in the hit rate, the average and the P&amp;L.{tr.all.outsideTrained ? ` ${tr.all.outsideTrained} outside trained hours.` : ''}</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full font-mono text-t11 [&_th+th]:pl-3 [&_td+td]:pl-3">
          <thead>
            <tr className="text-textMuted text-t9 uppercase tracking-widest">
              <th className="text-left font-normal pb-1" />
              <th className="text-right font-normal pb-1">Calls</th>
              <th className="text-right font-normal pb-1">Won · lost</th>
              <th className="text-right font-normal pb-1">Hit</th>
              <th className="text-right font-normal pb-1 max-sm:hidden">Avg return</th>
              <th className="text-right font-normal pb-1">P&amp;L</th>
              <th className="text-right font-normal pb-1 max-md:hidden">Worst</th>
            </tr>
          </thead>
          <tbody>
            <Row label="All calls" line={tr.all} strong testId="all" />
            {(['A', 'B', 'C'] as const).map(b => <Row key={b} label={BOOK_NAME[b]} line={tr.byBook[b]} testId={`book-${b}`} />)}
            {sessions.map(k => <Row key={k} label={SESSION_WORD[k]} line={tr.bySession[k]} testId={`session-${k}`} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** The session date a call belongs to (its record file): the call's own day, or the next day for an overnight call
    made after 20:15 ET. */
function sessionDay(s: Signal): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(s.firedAt));
  const m = (Number(p.find(x => x.type === 'hour')?.value) % 24) * 60 + Number(p.find(x => x.type === 'minute')?.value);
  if (m < 20 * 60 + 15) return s.day;
  /* the next weekday */
  const d = new Date(`${s.day}T12:00:00Z`);
  let n = new Date(d.getTime() + 86_400_000);
  while (n.getUTCDay() === 0 || n.getUTCDay() === 6) n = new Date(n.getTime() + 86_400_000);
  return n.toISOString().slice(0, 10);
}

export default TrackRecord;
