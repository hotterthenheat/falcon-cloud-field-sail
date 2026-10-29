/*
  Every expiry choice opens the calendar. The trigger is the dropdown card's; the card is ExpiryPicker's calendar.
  A desk with a fixed set of expiries lights only those days; a desk that prices any day lights every trading day in
  reach. A choice without a date ("Every expiry") is a pill. Named tenors (Compass) are dropdown rows, not days.
*/

import { useState, type CSSProperties } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { CARD, type DropdownOption } from './DropdownSelect';
import { isoDate, isTradingDay, today } from '../../core/calendar';

const SILVER_FILL = 'rgb(var(--silver-fill))';

/** A choice and the real day it resolves to — null for a choice that is not a day */
export interface ExpiryChoice<T extends string | number> extends DropdownOption<T> {
  date: Date | null;
  /** A choice the desk cannot draw right now: its day stays dim, its pill inert, and the hint says why */
  disabled?: boolean;
}

interface ExpiryCardProps<T extends string | number> {
  label?: string;
  value: T;
  choices: ExpiryChoice<T>[];
  onChange: (v: T) => void;
  /** The host prices ANY trading day up to `days` calendar days out, and turns a day into its value */
  free?: { days: number; toValue: (d: Date) => T | null };
  title?: string;
  align?: 'start' | 'end';
  icon?: LucideIcon;
  ink?: string;
  testId?: string;
  /** One line the card says about the choices right now — why some days are dim */
  note?: string;
  /** Trigger height: 28 by default; `sm` is 24, beside a rail's view tabs */
  size?: 'md' | 'sm';
  /** Hide the printed name on a line too short for it; it stays in the tooltip, aria-label and open card heading. */
  bare?: boolean;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const ExpiryCard = <T extends string | number>({ label = 'Expiry', value, choices, onChange, free, title, align = 'start', icon: Icon = CalendarDays, ink, testId, note, size = 'md', bare = false }: ExpiryCardProps<T>) => {
  const [open, setOpen] = useState(false);
  const t = today();
  const current = choices.find(c => c.value === value);
  const byDay = new Map<string, ExpiryChoice<T>>();
  for (const c of choices) if (c.date && !byDay.has(isoDate(c.date))) byDay.set(isoDate(c.date), c);
  const last = free ? addDays(t, free.days) : null;
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };
  const pickDay = (d: Date) => {
    const hit = byDay.get(isoDate(d));
    if (hit) return pick(hit.value);
    if (free) {
      const v = free.toValue(d);
      if (v != null) pick(v);
    }
  };
  const selected = current?.date ?? undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-dropdown={testId ?? label}
          data-expiry-card
          aria-label={`${label}: ${current?.label ?? ''}`}
          title={note ?? (bare ? label : undefined)}
          data-expiry-note={note ? '' : undefined}
          className={`group inline-flex items-center gap-1.5 ${size === 'sm' ? 'h-6 px-2' : 'h-7 px-2.5'} rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none`}
          style={ink ? ({ '--ink': ink } as CSSProperties) : undefined}
        >
          <Icon
            className={`w-3 h-3 shrink-0 transition-colors duration-200 ${ink ? 'text-textMuted group-hover:text-ink group-data-[state=open]:text-ink' : 'text-textMuted'}`}
            aria-hidden="true"
            data-dropdown-icon
          />
          {!bare && <span className="text-t9 uppercase tracking-widest text-textMuted">{label}</span>}
          <span className="text-t11 font-semibold text-textPrimary">{current?.label ?? '—'}</span>
          <ChevronDown className="w-3 h-3 text-textMuted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={12} className={`${CARD} p-3 outline-none w-[300px]`} data-dropdown-card={testId ?? label} data-date-picker>
          {/* just the calendar: the title, the grid with the desk's days lit, one line at the foot */}
          <div className="px-0.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{title ?? label}</div>
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={d => d && pickDay(d)}
            defaultMonth={selected ?? t}
            /* a day is pickable when it is a session AND the desk prices it */
            disabled={d => d < t || !isTradingDay(d) || (free ? d > last! : !byDay.has(isoDate(d)) || !!byDay.get(isoDate(d))?.disabled)}
            showOutsideDays
            weekStartsOn={0}
            components={{
              Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />),
            }}
            classNames={{
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
            }}
          />
          {note && (
            <p className="mt-2 text-t10 leading-snug text-textSecondary" data-expiry-card-note>
              {note}
            </p>
          )}
          <div className="mt-2 pt-2 border-t border-borderSubtle/70 flex items-center justify-between gap-3">
            <p className="text-t10 text-textMuted">{free ? `Any trading day up to ${free.days} days out.` : 'The lit days are the expiries this desk prices.'}</p>
            {/* a choice that is not a day (the book's "Every expiry") sits at the foot, alone */}
            {choices
              .filter(c => !c.date)
              .map(c => {
                const on = c.value === value;
                return (
                  <button
                    key={String(c.value)}
                    type="button"
                    onClick={() => pick(c.value)}
                    aria-pressed={on}
                    disabled={c.disabled}
                    title={c.hint}
                    className="shrink-0 h-6 px-2 rounded-full border text-t10 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={on ? { background: SILVER_FILL, color: '#0a0a0a', borderColor: SILVER_FILL } : { color: 'rgb(var(--text-secondary))', borderColor: 'rgb(var(--border-muted))' }}
                    data-expiry-choice={String(c.value)}
                  >
                    {c.label}
                  </button>
                );
              })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default ExpiryCard;
