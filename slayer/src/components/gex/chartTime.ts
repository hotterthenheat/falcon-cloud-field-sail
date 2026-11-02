/* One clock for every chart: lightweight-charts stamps epoch axes in UTC with no timezone option,
   so every createChart imports these formatters, which speak the reader's chosen zone. */

import {
  TickMarkType,
  createChartEx,
  defaultHorzScaleBehavior,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type Mutable,
  type Time,
  type TickMarkFormatter,
  type TimeScalePoint,
} from 'lightweight-charts';
import { clockZoneOf, readDeskPrefs } from '../../data/deskPrefs';
import { MONTHS } from '../../core/calendar';
import { fillZoneWeights, zoneShift } from './zoneWeights';

const two = (n: number) => String(n).padStart(2, '0');

/* The reader's clock (Settings, and Terrain's timezone door): the machine's zone, New York's, UTC, London's or Tokyo's
   (deskPrefs CLOCK_ZONES). An instant in a zone comes back as a Date whose fields read that zone's wall clock (built
   from Intl parts, one formatter a zone, kept) — for labels only, never arithmetic. */
const NY = 'America/New_York';
const zoneFmts = new Map<string, Intl.DateTimeFormat>();
function inZone(d: Date, zone: string): Date {
  let f = zoneFmts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    zoneFmts.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(d)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return new Date(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
}

/** Every `Time` shape the library accepts, as a Date in the chosen clock. A BusinessDay is built field by field:
    `new Date('YYYY-MM-DD')` parses as UTC midnight, the previous day west of Greenwich. */
/* 'reader' is the Settings choice; 'ny' is New York whatever was chosen, for a tape that is the market's own day (the backtest). */
export type ChartClock = 'reader' | 'ny';

function chartDate(t: Time, clock: ChartClock = 'reader'): Date {
  if (typeof t === 'number') {
    const d = new Date(t * 1000);
    const zone = clock === 'ny' ? NY : clockZoneOf(readDeskPrefs().clock);
    return zone ? inZone(d, zone) : d;
  }
  if (typeof t === 'string') {
    const [y, m, d] = t.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  return new Date(t.year, t.month - 1, t.day);
}

/** `14:50` — the clock the cards, the wire and the tape all speak. */
export const fmtClockLocal = (t: Time, clock?: ChartClock): string => {
  const d = chartDate(t, clock);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** `Aug 30` */
export const fmtDayLocal = (t: Time, clock?: ChartClock): string => {
  const d = chartDate(t, clock);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/** `Aug 30, 14:50`: the crosshair label for a chart spanning more than one session. */
export const fmtStampLocal = (t: Time, clock?: ChartClock): string => `${fmtDayLocal(t, clock)}, ${fmtClockLocal(t, clock)}`;

/** Axis ticks in the reader's zone: day ticks bare, month ticks named (the library emits a Month tick at each boundary). */
const tickMarks = (time: Time, type: TickMarkType, clock: ChartClock): string => {
  const d = chartDate(time, clock);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    case TickMarkType.TimeWithSeconds:
      return `${fmtClockLocal(time, clock)}:${two(d.getSeconds())}`;
    default:
      return fmtClockLocal(time, clock);
  }
};
export const localTickMarks: TickMarkFormatter = (time, type) => tickMarks(time, type, 'reader');
/** The same ticks on New York's clock, whatever the reader chose (see ChartClock) */
export const nyTickMarks: TickMarkFormatter = (time, type) => tickMarks(time, type, 'ny');

/** For `createChart` on a chart that spans days (`localization: LOCAL_TIME`); single-session panes pass `{ timeFormatter: fmtClockLocal }`. */
export const LOCAL_TIME = { timeFormatter: (t: Time) => fmtStampLocal(t) };
/** The crosshair's stamp on New York's clock, whatever the reader chose (see ChartClock) */
export const NY_TIME = { timeFormatter: (t: Time) => fmtStampLocal(t, 'ny') };

/* The zone a chart's ticks are weighed in: New York for a 'ny' tape, else the reader's choice (null = the machine's) */
const tickZone = (clock: ChartClock): string | null => (clock === 'ny' ? NY : clockZoneOf(readDeskPrefs().clock));

/** `createChart` whose Day/Month/Year ticks fall on the zone's own midnights (zoneWeights.ts) — the formatters above
    name a tick in the zone, so the library must also place it there or a tape running past UTC midnight (the
    overnight session) names one day twice. `clock` is read each time the library weighs new points; after the
    reader changes zone, `rezoneAxis` re-weighs what is already on the chart. */
export function createZonedChart(container: HTMLElement, options: DeepPartial<ChartOptions>, clock: () => ChartClock): IChartApi {
  const Base = defaultHorzScaleBehavior();
  class ZonedTime extends Base {
    fillWeightsForPoints(points: readonly Mutable<TimeScalePoint>[], start: number): void {
      fillZoneWeights(points, start, zoneShift(tickZone(clock())));
    }
  }
  /* createChart's own default (HorzScaleBehaviorTime.applyDefaults), which createChartEx skips */
  const opts = { ...options, localization: { dateFormat: "dd MMM 'yy", ...options.localization } } as DeepPartial<ChartOptions>;
  return createChartEx<Time, ZonedTime>(container, new ZonedTime(), opts as never) as unknown as IChartApi;
}

/** Re-weigh a zoned chart's axis after the zone changed: the library only re-weighs points that change, so one
    whitespace point before the first bar is set and taken away again (same frame, nothing drawn in between). */
export function rezoneAxis(series: { data(): readonly unknown[]; setData(d: never[]): void } | null | undefined): void {
  if (!series) return;
  const data = series.data() as Array<{ time: Time }>;
  const t0 = data[0]?.time;
  if (typeof t0 !== 'number') return;
  series.setData([{ time: t0 - 1 }, ...data] as never[]);
  series.setData(data as never[]);
}
