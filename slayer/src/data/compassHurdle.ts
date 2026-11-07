/* The research hurdle (research/edge0dte/results/HURDLE.md, PROTOCOL §5), read in one place: the sign-aligned mean
   move, in priced moves, a long 0.30-delta 0DTE option needs before it makes money after its round trip, by root,
   30-minute bucket and horizon, with its day-clustered 95% interval. The numbers live in compassHurdle.gen.ts, written
   from the markdown by scripts/compass-hurdle-sync.ts; nothing else in the app holds a copy. They are DISCOVERY-period
   research numbers (2020–2023), shown beside a call as context: never a gate, never a forecast. */

import { HURDLE_ROWS, HURDLE_SESSIONS, HURDLE_SHA256 } from './compassHurdle.gen';

export interface HurdleRow {
  root: string;
  bucket: string;
  h: number | 'close';
  times: number;
  cost: number | null;
  hz: number | null;
  lo: number | null;
  hi: number | null;
}

export { HURDLE_SESSIONS, HURDLE_SHA256 };

/** The research names the PM-settled index root SPXW; SPX reads it. */
const ROOT_OF: Record<string, string> = { SPX: 'SPXW', SPXW: 'SPXW' };

/** The research horizon a hold of `minutes` sits nearest: 15, 30 or 60 minutes, or 'close' past 90. */
export function horizonOf(minutes: number): number | 'close' {
  if (!(minutes > 0)) return 15;
  if (minutes <= 22) return 15;
  if (minutes <= 45) return 30;
  if (minutes <= 90) return 60;
  return 'close';
}

/** The research's 30-minute bucket of a New York minute of the day ('09:30' holds 09:45–09:59). */
export function bucketOf(minuteOfDay: number): string {
  const b = Math.floor(minuteOfDay / 30) * 30;
  return `${String(Math.floor(b / 60)).padStart(2, '0')}:${String(b % 60).padStart(2, '0')}`;
}

export interface HurdleRead extends HurdleRow {
  /** The bucket had no number of its own: the root's pooled row */
  pooled: boolean;
  /** DISCOVERY sessions behind the root's numbers */
  sessions: number;
}

/** The hurdle for a call on `root` at a New York minute, held `holdMin` minutes; null for a root the research has not
    measured. The call's own bucket when it has a number, else the root's pooled row at that horizon. */
export function hurdleFor(root: string, minuteOfDay: number, holdMin: number, rows: readonly HurdleRow[] = HURDLE_ROWS): HurdleRead | null {
  const r = ROOT_OF[root] ?? root;
  const h = horizonOf(holdMin);
  const own = rows.find(x => x.root === r && x.h === h && x.bucket === bucketOf(minuteOfDay) && x.hz != null);
  const pool = rows.find(x => x.root === r && x.h === h && x.bucket === 'all' && x.hz != null);
  const got = own ?? pool;
  return got ? { ...got, pooled: !own, sessions: HURDLE_SESSIONS[r] ?? 0 } : null;
}
