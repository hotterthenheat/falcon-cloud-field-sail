/*
  A date control on react-day-picker (classes ours, none of its stylesheet) inside a Radix Popover, made for expiries:
  weekends, holidays and past days are disabled, and today, this Friday, next Friday and the monthly sit above the grid.
*/

import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isoDate, isTradingDay, nextSession, today } from '../../core/calendar';

const SILVER_FILL = 'rgb(var(--silver-fill))'; /* the silver as a SURFACE — a filled pill with the dark word on it, the holo flat form on either ground */

const parse = (iso: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};
const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Back off a holiday to the session before it — a Friday holiday expires Thursday */
const backToSession = (d: Date) => {
  const out = new Date(d);
  for (let i = 0; i < 7 && !isTradingDay(out); i++) out.setDate(out.getDate() - 1);
  return out;
};
const fridayOnOrAfter = (d: Date) => addDays(d, (5 - d.getDay() + 7) % 7);
const thirdFriday = (year: number, month: number) => {
  const first = new Date(year, month, 1);
  return addDays(first, ((5 - first.getDay() + 7) % 7) + 14);
};

/** The four dates a trader reaches for, each a real session */
function quickExpiries(from: Date = today()): { label: string; date: Date }[] {
  const thisFri = backToSession(fridayOnOrAfter(from));
  const nextFri = backToSession(addDays(fridayOnOrAfter(from), 7));
  let monthly = backToSession(thirdFriday(from.getFullYear(), from.getMonth()));
  if (monthly < from) monthly = backToSession(thirdFriday(from.getFullYear(), from.getMonth() + 1));
  /* On a weekend or a holiday the first pill is the next session, named as such */
  const open = isTradingDay(from);
  const out = [
    { label: open ? 'Today' : 'Next session', date: open ? from : nextSession(from) },
    { label: 'This Friday', date: thisFri },
    { label: 'Next Friday', date: nextFri },
    { label: 'Monthly', date: monthly },
  ];
  // Two picks that land on the same day keep the first name only
  return out.filter((q, i) => out.findIndex(o => isoDate(o.date) === isoDate(q.date)) === i);
}

interface DateBoardProps {
  /** An expiry is today or later. The day you entered is today or earlier. */
  mode: 'expiry' | 'entered';
  value: string;
  onChange: (iso: string) => void;
  /** Inclusive. An entered day cannot fall after the expiry, and an expiry cannot fall before it. */
  floor?: string;
  ceiling?: string;
}

const prevSession = (from: Date): Date => {
  const out = new Date(from);
  do out.setDate(out.getDate() - 1);
  while (!isTradingDay(out));
  return out;
};

/** The days a trader reaches for when writing the day they got in. */
function quickEntered(from: Date = today()): { label: string; date: Date }[] {
  const yday = prevSession(from);
  let friday = new Date(from);
  do friday = prevSession(friday);
  while (friday.getDay() !== 5);
  let week = from;
  for (let i = 0; i < 5; i++) week = prevSession(week);
  const out = [
    { label: 'Today', date: from },
    { label: 'Yesterday', date: yday },
    { label: 'Last Friday', date: friday },
    { label: 'A week ago', date: week },
  ];
  return out.filter((q, i) => out.findIndex(o => isoDate(o.date) === isoDate(q.date)) === i);
}

const DAY_CLASS = {
  root: 'relative select-none',
  months: 'flex',
  month: 'w-full',
  month_caption: 'h-8 flex items-center px-1 text-t12 font-semibold text-textPrimary',
  caption_label: '',
  nav: 'absolute top-0 right-0 h-8 flex items-center gap-1',
  button_previous: 'w-7 h-7 inline-flex items-center justify-center rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors disabled:opacity-30',
  button_next: 'w-7 h-7 inline-flex items-center justify-center rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors disabled:opacity-30',
  chevron: '',
  month_grid: 'w-full border-collapse mt-1',
  weekdays: '',
  weekday: 'h-7 text-t10 font-normal text-textMuted text-center',
  weeks: '',
  week: '',
  day: 'p-0 text-center',
  day_button: 'w-9 h-8 rounded-md font-mono text-t12 tnum text-textPrimary hover:bg-ink/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-silver/60',
  selected: '[&>button]:bg-silverFill [&>button]:text-onfoil [&>button]:font-semibold [&>button:hover]:bg-silverFill',
  today: '[&>button]:shadow-[inset_0_0_0_1px_rgba(199,211,232,0.45)]',
  outside: '[&>button]:text-textMuted/40',
  disabled: '[&>button]:text-textMuted/30 [&>button]:cursor-not-allowed [&>button:hover]:bg-transparent',
  hidden: 'invisible',
  focused: '',
};

/** One calendar. Expiry and the day you entered are the same grid, with different days open. */
export function DateBoard({ mode, value, onChange, floor, ceiling }: DateBoardProps) {
  const selected = parse(value);
  const t = today();
  const floorD = floor ? parse(floor) : undefined;
  const ceilingD = ceiling ? parse(ceiling) : undefined;
  const picks = (mode === 'entered' ? quickEntered(t) : quickExpiries(t)).filter(q => {
    if (floorD && q.date < floorD) return false;
    if (ceilingD && q.date > ceilingD) return false;
    if (mode === 'entered' && q.date > t) return false;
    if (mode === 'expiry' && q.date < t) return false;
    return isTradingDay(q.date);
  });
  const blocked = (d: Date) => {
    if (!isTradingDay(d)) return true;
    if (mode === 'expiry' && d < t) return true;
    if (mode === 'entered' && d > t) return true;
    if (floorD && d < floorD) return true;
    if (ceilingD && d > ceilingD) return true;
    return false;
  };
  return (
    <div data-date-board={mode}>
      <div className="flex flex-wrap gap-1.5 pb-3 mb-2 border-b border-borderSubtle/70" data-quick-picks>
        {picks.map(q => {
          const on = isoDate(q.date) === value;
          return (
            <button
              key={q.label}
              type="button"
              onClick={() => onChange(isoDate(q.date))}
              aria-pressed={on}
              title={fmt(q.date)}
              className="h-7 px-2.5 rounded-full border text-t11 font-medium transition-colors"
              style={on ? { background: SILVER_FILL, color: '#0a0a0a', borderColor: SILVER_FILL } : { color: 'rgb(var(--text-secondary))', borderColor: 'rgb(var(--border-muted))' }}
            >
              {q.label}
            </button>
          );
        })}
      </div>
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={d => d && onChange(isoDate(d))}
        defaultMonth={selected ?? t}
        disabled={blocked}
        showOutsideDays
        weekStartsOn={0}
        components={{
          Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />),
        }}
        classNames={DAY_CLASS}
      />
      <p className="mt-2 pt-2 border-t border-borderSubtle/70 text-t10 text-textMuted">Only trading days can be picked.</p>
    </div>
  );
}

