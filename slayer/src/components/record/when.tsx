/* A date on the record is a date with the distance beside it ("09/11 · 2d ago"), on the terminal's own clock. */

import { now } from '../../core/clock';
import { nyParts } from '../../core/nyTime';

interface WhenParts {
  /** "09/11" */
  date: string;
  /** "today" · "yesterday" · "2d ago" */
  ago: string;
  /** "Thu 09/11" — for a sentence or a title */
  long: string;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const two = (n: number) => String(n).padStart(2, '0');

/** The calendar day `daysAgo` days before today — NEW YORK's today, the same calendar the offsets are counted on
    (data/nyDate.ts). Read off the machine's local date, a UTC browser after 20:00 New York put every row a day late. */
const dayBefore = (daysAgo: number, from: Date = now()): Date => {
  const p = nyParts(from);
  return new Date(p.year, p.month - 1, p.day - Math.max(0, Math.round(daysAgo)), 12);
};

export const agoWords = (daysAgo: number): string => (daysAgo <= 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`);

export const whenParts = (daysAgo: number, from: Date = now()): WhenParts => {
  const d = dayBefore(daysAgo, from);
  /* a day in another year carries its year ("03/04/23") — "03/04 · 1328d ago" left the reader to work it out */
  const year = d.getFullYear() !== nyParts(from).year ? `/${String(d.getFullYear()).slice(2)}` : '';
  const date = `${two(d.getMonth() + 1)}/${two(d.getDate())}${year}`;
  return { date, ago: agoWords(daysAgo), long: `${WEEKDAY[d.getDay()]} ${date}` };
};

/** The date and its distance, as one cell: "09/11 · 2d ago" */
export const When = ({ days, size = 11 }: { days: number; size?: 10 | 11 }) => {
  const w = whenParts(days);
  return (
    <span className={`font-mono tnum whitespace-nowrap ${size === 11 ? 'text-t11' : 'text-t10'}`} title={w.long} data-when={w.date} data-when-ago={days}>
      <span className="text-textPrimary">{w.date}</span>
      <span className="text-textMuted"> · {w.ago}</span>
    </span>
  );
};
