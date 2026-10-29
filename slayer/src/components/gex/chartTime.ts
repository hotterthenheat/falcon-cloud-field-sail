/* One clock for every chart: lightweight-charts stamps epoch axes in UTC with no timezone option,
   so every createChart imports these formatters, which speak the reader's chosen zone. */

import { TickMarkType, type Time, type TickMarkFormatter } from 'lightweight-charts';
import { readDeskPrefs } from '../../data/deskPrefs';
import { MONTHS } from '../../core/calendar';

const two = (n: number) => String(n).padStart(2, '0');

/* The reader's clock (Settings): the machine's zone or New York's. A New York instant comes back as a Date whose fields read
   New York's wall clock (built from Intl parts) — for labels only, never arithmetic. */
const NY = 'America/New_York';
let nyFmt: Intl.DateTimeFormat | null = null;
function inNewYork(d: Date): Date {
  nyFmt ??= new Intl.DateTimeFormat('en-US', { timeZone: NY, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p: Record<string, number> = {};
  for (const part of nyFmt.formatToParts(d)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return new Date(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
}

/** Every `Time` shape the library accepts, as a Date in the chosen clock. A BusinessDay is built field by field:
    `new Date('YYYY-MM-DD')` parses as UTC midnight, the previous day west of Greenwich. */
/* 'reader' is the Settings choice; 'ny' is New York whatever was chosen, for a tape that is the market's own day (the backtest). */
export type ChartClock = 'reader' | 'ny';

function chartDate(t: Time, clock: ChartClock = 'reader'): Date {
  if (typeof t === 'number') {
    const d = new Date(t * 1000);
    return clock === 'ny' || readDeskPrefs().clock === 'ny' ? inNewYork(d) : d;
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
