/*
==================================================
  SLAYER TERMINAL - THE LADDER CARD'S OWN CONTROLS
  Shared by the Pulse widget and the Pinpoint card so
  the two Strike Pressure Ladder cards are ONE card
  (Noah, 2026-09-05, the Pinpoint copy beside the
  widget: "it does not look like the provided image…
  i see some random 0dte, 1d, 2d, etc outside of the
  card itself"). The controls live INSIDE the card —
  a view strip, the expiry strip, the strike range,
  the fullscreen — and the engine's pattern read
  sits under them as the card's own sentence.
==================================================
*/

import type { ExpiryChoice } from '../ui/ExpiryCard';
import { bookToday, expiryFor, isoDate, sessionsBetween, today, MONTHS } from '../../core/calendar';
import { STRIKE_WINDOWS, type StrikeWindow } from '../../data/exposure';
import { expiryDateFor } from '../../data/uwBook';
import type { ExposureExpiry } from '../../types/gex';

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

/** THE EXPIRIES AS DATES (Noah, 2026-09-08: "the ladder doesn't have dates for
    exp, it just says 1d 2d 3d") — the same choices, spelled as the day they
    resolve to on the market calendar, with one plain line each. One list for
    the Map's Expiry card and the desk's ladder. */
export function ladderExpiryOptions(ticker?: string): ExpiryChoice<ExposureExpiry>[] {
  const base = bookToday();
  /* the five-session choice only ends THIS week from a Monday — from a Thursday it lands on next Tuesday, and the hint
     said "the end of this week" over Oct 27 · Tue (the ship pass, 2026-10-22) */
  const weekWord = (d: Date) => {
    const n = sessionsBetween(base, d);
    const sameWeek = d.getDay() === 5 && d.getTime() - base.getTime() < 7 * 86_400_000 && d.getDay() >= base.getDay();
    return sameWeek ? 'The end of this week' : `${n} session${n === 1 ? '' : 's'} out`;
  };
  const day = (dte: number) => expiryFor(dte, base);
  const t0 = day(0);
  const isToday = t0.dte === 0 && isoDate(t0.date) === isoDate(today());
  /* each choice carries its real day — the calendar card lights those days (2026-09-12) — and a day is offered once:
     from a Thursday "1D" and "2D" both land on Friday (the weekend walks back), and the list read "Oct 23 · Fri" twice */
  const seen = new Set<string>();
  return ([
    { value: '0DTE', label: isToday ? `Today · ${fmtDay(t0.date)}` : `Next session · ${fmtDay(t0.date)}`, hint: 'The contracts that expire at the bell — the sharpest hedging', date: t0.date },
    { value: '1D', label: `${fmtDay(day(1).date)} · ${day(1).weekday}`, hint: 'The next expiry out', date: day(1).date },
    { value: '2D', label: `${fmtDay(day(2).date)} · ${day(2).weekday}`, hint: 'Two sessions out', date: day(2).date },
    { value: '5D', label: `${fmtDay(day(5).date)} · ${day(5).weekday}`, hint: weekWord(day(5).date), date: day(5).date },
    { value: '7D', label: `${fmtDay(day(7).date)} · ${day(7).weekday}`, hint: 'A week out', date: day(7).date },
    { value: 'OPEX', label: `${fmtDay(monthlyExpiry(base))} · monthly`, hint: 'The monthly expiration — the heaviest structure', date: monthlyExpiry(base) },
    { value: 'ALL', label: 'All expiries', hint: 'Every listed expiry, weighed together', date: null },
  ] as ExpiryChoice<ExposureExpiry>[])
    /* NAMED FOR THE DATE THE BOOK READS (the ship pass, 2026-10-22): the choices are the market calendar's, but a name
       lists only some days — NVDA has no Oct 22, and "Today · Oct 22" read its Oct 23 book. With a name in hand each
       choice says the listing it lands on. */
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
}

/** ±10 for the day's fight, ±30 for the whole book — the tail hedges live out there */
export const LADDER_RANGES: StrikeWindow[] = STRIKE_WINDOWS;

