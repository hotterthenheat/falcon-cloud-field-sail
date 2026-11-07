/* The ladder card's own controls, shared by the Pulse widget and the Pinpoint card so the two are one card:
   view, expiry, strike range and fullscreen inside the card, the pattern read under them. */

import type { ExpiryChoice } from '../ui/ExpiryCard';
import { bookToday, expiryFor, isoDate, sessionsBetween, today, MONTHS } from '../../core/calendar';
import { STRIKE_WINDOWS, type StrikeWindow } from '../../data/exposure';
import { expiryDateFor } from '../../data/book/levels';
import type { ExposureExpiry } from '../../types/gex';
import { pickableExpiries } from '../../data/expiryListing';

const fmtDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
/** The monthly expiration: the third Friday of this month, or next month's once it has passed */
const monthlyExpiry = (from: Date): Date => {
  const third = (y: number, m: number) => {
    const d = new Date(y, m, 1);
    const offset = (5 - d.getDay() + 7) % 7;
    return new Date(y, m, 1 + offset + 14);
  };
  const now = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const thisMonth = third(now.getFullYear(), now.getMonth());
  return thisMonth >= now ? thisMonth : third(now.getFullYear(), now.getMonth() + 1);
};

/** The expiries as the dates they resolve to on the market calendar, with one plain line each; one list for the Map's Expiry card and the ladder. */
export function ladderExpiryOptions(ticker?: string): ExpiryChoice<ExposureExpiry>[] {
  const base = bookToday();
  /* The five-session choice ends this week only from a Monday. */
  const weekWord = (d: Date) => {
    const n = sessionsBetween(base, d);
    const sameWeek = d.getDay() === 5 && d.getTime() - base.getTime() < 7 * 86_400_000 && d.getDay() >= base.getDay();
    return sameWeek ? 'The end of this week' : `${n} session${n === 1 ? '' : 's'} out`;
  };
  const day = (dte: number) => expiryFor(dte, base);
  const t0 = day(0);
  const isToday = t0.dte === 0 && isoDate(t0.date) === isoDate(today());
  /* Each choice carries its real day (the calendar card lights it), and a day is offered once: from a Thursday 1D and 2D both land on Friday. */
  const seen = new Set<string>();
  const choices = ([
    { value: '0DTE', label: isToday ? `Today · ${fmtDay(t0.date)}` : `Next session · ${fmtDay(t0.date)}`, hint: 'The contracts that expire at the bell — the sharpest hedging', date: t0.date },
    { value: '1D', label: `${fmtDay(day(1).date)} · ${day(1).weekday}`, hint: 'The next expiry out', date: day(1).date },
    { value: '2D', label: `${fmtDay(day(2).date)} · ${day(2).weekday}`, hint: 'Two sessions out', date: day(2).date },
    { value: '5D', label: `${fmtDay(day(5).date)} · ${day(5).weekday}`, hint: weekWord(day(5).date), date: day(5).date },
    { value: '7D', label: `${fmtDay(day(7).date)} · ${day(7).weekday}`, hint: 'A week out', date: day(7).date },
    { value: 'OPEX', label: `${fmtDay(monthlyExpiry(base))} · monthly`, hint: 'The monthly expiration — the heaviest structure', date: monthlyExpiry(base) },
    { value: 'ALL', label: 'All expiries', hint: 'Every listed expiry, weighed together', date: null },
  ] as ExpiryChoice<ExposureExpiry>[])
    /* With a name in hand each choice names the listing it lands on (a name lists only some days). */
    .map(o => {
      if (!ticker || !o.date) return o;
      const hit = expiryDateFor(ticker, o.value);
      if (!hit || hit === isoDate(o.date)) return o;
      const d = new Date(`${hit}T00:00:00`);
      const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
      return o.value === '0DTE'
        ? { ...o, label: `${fmtDay(d)} · next expiry`, hint: `Nothing on ${ticker} expires ${fmtDay(o.date)} — its next listing`, date: d }
        : { ...o, label: `${fmtDay(d)} · ${wd}`, hint: `${sessionsBetween(base, d)} session${sessionsBetween(base, d) === 1 ? '' : 's'} out — ${ticker}'s nearest listing`, date: d };
    })
    .filter(o => {
    if (!o.date) return true;
    const k = isoDate(o.date);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  /* a date the vendor lists with no contract behind it is not offered (data/expiryListing.ts); the book counts from its
     own floor, so the settled rule is its own */
  return pickableExpiries(ticker, choices, o => (o.date ? isoDate(o.date) : null), { settled: false });
}

/** ±10 for the day's fight, ±30 for the whole book — the tail hedges live out there */
export const LADDER_RANGES: StrikeWindow[] = STRIKE_WINDOWS;

