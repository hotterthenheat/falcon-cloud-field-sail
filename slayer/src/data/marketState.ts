/* Where the market is, one reading for the mark, the signature, the rail and the footer, plus a plain sentence per state
   (pre-market, open, after hours, closed, early close, holiday). Clock: data/moc.ts; holidays: core/calendar.ts; early closes: the exchange's. */

import { MARKET_HOLIDAYS, isTradingDay, isoDate } from '../core/calendar';
import { readSessionClock } from './moc';

const EARLY_CLOSES = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);

type MarketStateKind = 'open' | 'pre-market' | 'after-hours' | 'closed' | 'early-close' | 'holiday';

interface MarketState {
  kind: MarketStateKind;
  /** the state word the brand prints beside the dot */
  word: 'live' | 'closed';
  /** the short form the rail and the footer print: "pre-market", "market open", "after hours", "closed for the weekend" */
  short: string;
  /** one plain sentence */
  line: string;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** New York's calendar date as a local Date at midnight */
const nyDate = (now: Date): Date => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now).map(x => [x.type, x.value])
  );
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day));
};

const nextTradingDay = (from: Date): Date => {
  const d = new Date(from);
  do d.setDate(d.getDate() + 1);
  while (!isTradingDay(d));
  return d;
};

/** The holiday's name, by where it falls — enough for the line, not a calendar of its own */
function holidayName(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m === 1 && day <= 2) return 'New Year’s Day';
  if (m === 1) return 'Martin Luther King Jr. Day';
  if (m === 2) return 'Presidents’ Day';
  if (m === 3 || m === 4) return 'Good Friday';
  if (m === 5) return 'Memorial Day';
  if (m === 6) return 'Juneteenth';
  if (m === 7) return 'Independence Day';
  if (m === 9) return 'Labor Day';
  if (m === 11) return 'Thanksgiving';
  return 'Christmas';
}

const opensWhen = (today: Date, next: Date): string => {
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  const when = days <= 1 ? 'tomorrow ' : `${WEEKDAY[next.getDay()]} `;
  const early = EARLY_CLOSES.has(isoDate(next)) ? ' and closes early at 12:00 PM CT' : '';
  return `It opens ${when}at 8:30 AM CT${early}.`;
};

/** Where the market is right now, as the brand says it */
export function readMarketState(now: Date = new Date()): MarketState {
  const clock = readSessionClock(now);
  const today = nyDate(now);
  const key = isoDate(today);
  const weekend = today.getDay() === 0 || today.getDay() === 6;
  if (MARKET_HOLIDAYS.has(key) && !weekend) {
    const next = nextTradingDay(today);
    return { kind: 'holiday', word: 'closed', short: `closed for ${holidayName(today)}`, line: `Closed for ${holidayName(today)}. ${opensWhen(today, next).replace('It opens', 'The market opens')}` };
  }
  if (weekend) {
    const next = nextTradingDay(today);
    return { kind: 'closed', word: 'closed', short: 'closed for the weekend', line: `The market is closed. ${opensWhen(today, next)}` };
  }
  if (clock.phase === 'PREMARKET') {
    const early = EARLY_CLOSES.has(key) ? ' Early close today at 12:00 PM CT.' : '';
    return { kind: 'pre-market', word: 'closed', short: 'pre-market', line: `Pre-market. The market opens at 8:30 AM CT.${early}` };
  }
  if (clock.phase === 'OPEN' || clock.phase === 'AUCTION') {
    if (EARLY_CLOSES.has(key)) {
      /* the session clock runs to 16:00; an early close stops at 13:00 */
      if (Number(clock.etTime.slice(0, 2)) >= 13) return { kind: 'closed', word: 'closed', short: 'closed early', line: `The market closed early at 12:00 PM CT. ${opensWhen(today, nextTradingDay(today))}` };
      return { kind: 'early-close', word: 'live', short: 'market open', line: 'Early close today at 12:00 PM CT.' };
    }
    return { kind: 'open', word: 'live', short: 'market open', line: 'The market is open.' };
  }
  const next = nextTradingDay(today);
  /* after hours runs to 20:00 ET; past it the market is simply closed */
  if (clock.phase === 'AFTERHOURS' && Number(clock.etTime.slice(0, 2)) < 20) return { kind: 'after-hours', word: 'closed', short: 'after hours', line: `After hours. The market opens ${opensWhen(today, next).replace('It opens ', '')}` };
  return { kind: 'closed', word: 'closed', short: 'closed', line: `The market is closed. ${opensWhen(today, next)}` };
}
