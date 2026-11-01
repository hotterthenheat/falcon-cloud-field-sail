/* Terrain's server tapes on the price chart (data/tapeFeed.ts): the option prints the events lane names, the stock prints
   the dark-pool overlay draws — as lines for the few largest off-exchange prices, and as marks at their price on their
   bar for the session's largest off-exchange prints and blocks. Pure, so the chart only hands them to the library. */

import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';
import type { DarkPoolPrint } from '../../types/gex';
import type { FlowPrint } from '../../types/trace';
import type { FlowFilters } from '../../data/deskPrefs';
import type { StockMarkRow } from '../../data/tapeServer';
import type { TapeRow } from '../../data/tapeFeed';
import { legsInNet, tagsOfPrint } from '../../data/flowBuckets';
import { hasType } from '../../data/printTags';

const NY_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const NY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The off-exchange marks as the overlay's lines read them: the largest print at each price */
export function tapeDarkLines(marks: readonly StockMarkRow[]): DarkPoolPrint[] {
  const byPx = new Map<number, DarkPoolPrint>();
  for (const [ms, price, size, , kind] of marks) {
    if (kind === 1) continue;
    const px = Math.round(price * 100) / 100;
    const notional = price * size;
    const had = byPx.get(px);
    if (had && had.notional >= notional) continue;
    byPx.set(px, { price: px, notional, size, date: NY_DATE.format(new Date(ms)), time: NY_CLOCK.format(new Date(ms)) });
  }
  return [...byPx.values()].sort((a, b) => b.notional - a.notional);
}

/** The option prints the events lane and the premium VWAPs read on Terrain: whole prints of the pane's type, the legs of
    spreads only when the pane counts them */
export function tapeEventPrints(rows: readonly TapeRow[], f: FlowFilters): (FlowPrint & { at: number })[] {
  const legs = legsInNet(f);
  const out: (FlowPrint & { at: number })[] = [];
  for (const p of rows) {
    if (p.aggregate != null || !(p.epochMs && p.epochMs > 0)) continue;
    const tags = tagsOfPrint(p);
    if (f.kind !== 'all' && !hasType(tags, f.kind)) continue;
    if (tags.leg && !legs) continue;
    out.push({ ...p, at: p.epochMs });
  }
  return out;
}

/** Marks drawn at most */
export const STOCK_MARK_CAP = 24;

/**
 * The stock marks on the drawn bars (`barTimes`, unix seconds, each at most `barSec` long): the session's largest
 * STOCK_MARK_CAP by money, one of a kind per bar (the largest), at the print's own price. A circle off-exchange, a
 * square on an exchange (a block); the ink is the side the print took. No words: the overlay's lines name the largest.
 */
export function stockMarkers(marks: readonly StockMarkRow[], barTimes: readonly number[], barSec: number, inks: { buy: string; sell: string; none: string }): SeriesMarker<Time>[] {
  const n = barTimes.length;
  if (!n || !marks.length) return [];
  const barOf = (sec: number): number | null => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (barTimes[m] <= sec) lo = m + 1;
      else hi = m;
    }
    const i = lo - 1;
    if (i < 0) return null;
    const span = i + 1 < n ? Math.min(barSec, barTimes[i + 1] - barTimes[i]) : barSec;
    return sec < barTimes[i] + span ? barTimes[i] : null;
  };
  const best = new Map<string, { bar: number; row: StockMarkRow; money: number }>();
  for (const row of marks) {
    const bar = barOf(row[0] / 1000);
    if (bar == null) continue;
    const off = row[4] !== 1;
    const key = `${bar}|${off ? 'o' : 'x'}`;
    const money = row[1] * row[2];
    const had = best.get(key);
    if (!had || money > had.money) best.set(key, { bar, row, money });
  }
  const top = [...best.values()].sort((a, b) => b.money - a.money).slice(0, STOCK_MARK_CAP);
  return top
    .map(m => {
      const [, price, , , kind, side] = m.row;
      return {
        time: m.bar as UTCTimestamp,
        position: 'atPriceMiddle' as const,
        price,
        shape: kind === 1 ? ('square' as const) : ('circle' as const),
        color: side > 0 ? inks.buy : side < 0 ? inks.sell : inks.none,
        size: kind === 0 ? 0.8 : 1.2,
      };
    })
    .sort((a, b) => Number(a.time) - Number(b.time));
}
