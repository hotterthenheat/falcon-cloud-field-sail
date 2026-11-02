/* WHERE THE AXIS PUTS ITS DAY TICKS. lightweight-charts weighs each bar against the one before it on UTC's calendar: the
   first bar of a UTC day is a Day tick, and the formatter (chartTime) then names it in the reader's zone. West of
   Greenwich that is wrong once a tape runs past the UTC midnight — the overnight session's 20:00 New York bar (00:00
   UTC) became a Day tick named for the day it still is in New York, so an axis read "Oct 29 … Oct 29" and the next
   day never got its name. These weights are the library's own ladder (year, month, day, then 12h…1s) read on the
   chosen zone's wall clock, so a Day tick lands on the first bar of the zone's day. Pure: no chart import, proven in
   scripts/chart-zone-proof.ts. */

/** Seconds to add to an instant (UTC seconds) so its UTC fields read the zone's wall clock. */
export type ZoneShift = (sec: number) => number;

const HOUR = 3600;
const shiftFmts = new Map<string, Intl.DateTimeFormat>();

/** The shift for an IANA zone, or the machine's zone for null. Kept per hour: a zone's offset only moves on the hour. */
export function zoneShift(zone: string | null): ZoneShift {
  const byHour = new Map<number, number>();
  let f: Intl.DateTimeFormat | undefined;
  if (zone) {
    f = shiftFmts.get(zone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      shiftFmts.set(zone, f);
    }
  }
  const fmt = f;
  return (sec: number) => {
    const h = Math.floor(sec / HOUR);
    let off = byHour.get(h);
    if (off === undefined) {
      const at = h * HOUR * 1000;
      if (!fmt) off = -new Date(at).getTimezoneOffset() * 60;
      else {
        const p: Record<string, number> = {};
        for (const part of fmt.formatToParts(new Date(at))) if (part.type !== 'literal') p[part.type] = Number(part.value);
        off = (Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) - at) / 1000;
      }
      byHour.set(h, off);
    }
    return off;
  };
}

/* The library's TickMarkWeight values */
const YEAR = 70;
const MONTH = 60;
const DAY = 50;
const INTRADAY: ReadonlyArray<readonly [number, number]> = [
  [12 * HOUR, 33],
  [6 * HOUR, 32],
  [3 * HOUR, 31],
  [HOUR, 30],
  [30 * 60, 22],
  [5 * 60, 21],
  [60, 20],
  [1, 10],
];

/** The weight of a bar at `cur` after one at `prev` (both UTC seconds already shifted to the zone's wall clock). */
export function zoneWeight(cur: number, prev: number): number {
  const a = new Date(cur * 1000);
  const b = new Date(prev * 1000);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return YEAR;
  if (a.getUTCMonth() !== b.getUTCMonth()) return MONTH;
  if (a.getUTCDate() !== b.getUTCDate()) return DAY;
  for (const [div, w] of INTRADAY) if (Math.floor(prev / div) !== Math.floor(cur / div)) return w;
  return 0;
}

/** A point's original `Time` as UTC seconds on the zone's wall clock; a business day is already a date and is not shifted. */
function wallSec(t: unknown, shift: ZoneShift): number | null {
  if (typeof t === 'number') return t + shift(t);
  if (typeof t === 'string') {
    const [y, m, d] = t.split('-').map(Number);
    return Number.isFinite(y) ? Date.UTC(y, (m || 1) - 1, d || 1) / 1000 : null;
  }
  if (t && typeof t === 'object' && 'year' in t) {
    const o = t as { year: number; month: number; day: number };
    return Date.UTC(o.year, o.month - 1, o.day) / 1000;
  }
  return null;
}

/** The library's fillWeightsForPoints on the zone's calendar: weights from `start` on, and a guess for the first
    point from the average spacing (as the library does). */
export function fillZoneWeights(points: ReadonlyArray<{ timeWeight: number; originalTime: unknown }>, start: number, shift: ZoneShift): void {
  if (points.length === 0) return;
  const pts = points as Array<{ timeWeight: number; originalTime: unknown }>;
  let prev = start > 0 ? wallSec(pts[start - 1].originalTime, shift) : null;
  let first: number | null = null;
  let last: number | null = null;
  for (let i = start; i < pts.length; i++) {
    const cur = wallSec(pts[i].originalTime, shift);
    if (cur === null) continue;
    if (prev !== null) pts[i].timeWeight = zoneWeight(cur, prev);
    if (first === null) first = cur;
    last = cur;
    prev = cur;
  }
  if (start === 0 && pts.length > 1 && first !== null && last !== null) {
    const avg = Math.ceil((last - first) / (pts.length - 1));
    pts[0].timeWeight = zoneWeight(first, first - avg);
  }
}
