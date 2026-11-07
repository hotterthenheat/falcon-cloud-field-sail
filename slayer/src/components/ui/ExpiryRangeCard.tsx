/* A window of expiries (From and Through) on the expiry calendar: the armed row takes the next click, and the ends push each other
   to stay ordered. Shortcuts: Today, This week, Next 7. Days past the host's ceiling stay dim. */

import { FLAT_DOOR, FLAT_OPEN } from './flatDoor';
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { CARD } from './DropdownSelect';
import { isoDate, today } from '../../core/calendar';

const SILVER_FILL = 'rgb(var(--silver-fill))';

/** One expiry the book holds: its index (the value), its real day, the words for it */
export interface ExpiryDay {
  value: number;
  date: Date;
  label: string;
  hint?: string;
}
/** A window in one press */
export interface ExpiryShortcut {
  label: string;
  hint?: string;
  from: number;
  through: number;
}

interface ExpiryRangeCardProps {
  label?: string;
  days: ExpiryDay[];
  from: number;
  through: number;
  onChange: (from: number, through: number) => void;
  /** The most expiries the host draws at once */
  ceiling: number;
  /** Why — "7 at most with five greeks" */
  ceilingWhy: string;
  shortcuts: ExpiryShortcut[];
  /** One line the card says about the window right now — what fits */
  note?: string;
  title?: string;
  align?: 'start' | 'end';
  testId?: string;
  /** The card WITHOUT its printed name — for a line that measured itself too short */
  bare?: boolean;
  /** The house's flat control (ui/flatDoor.ts) — the Map band's */
  flat?: boolean;
  /** What the host actually draws when its width cuts the window short: the last expiry drawn and the count, so the
      trigger reads "Today -> Oct 16 · 4 of 7". */
  cut?: { through: number; shown: number; wanted: number };
}

type Side = 'from' | 'through';

const ExpiryRangeCard = ({ label = 'Expiries', days, from, through, onChange, ceiling, ceilingWhy, shortcuts, note, title, align = 'start', testId, bare = false, flat = false, cut }: ExpiryRangeCardProps) => {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>('through');
  const t = today();
  const byDay = new Map<string, ExpiryDay>();
  for (const d of days) if (!byDay.has(isoDate(d.date))) byDay.set(isoDate(d.date), d);
  /* by value, not by place: a list may leave a day out (a date with no contract behind it, data/expiryListing.ts), and
     an index that is not drawn reads as the next day that is */
  const at = (i: number) => days.find(d => d.value >= i) ?? days[days.length - 1];
  const a = at(from);
  const b = at(through);
  const one = a.value === b.value;
  /* what the trigger prints: "Today" · "Today → Oct 12" · "Sep 23 → Oct 12" */
  /* …and, cut short by the fit, the window DRAWN with the count; cut to one column (a phone), the one day */
  const isCut = !!cut && !one && cut.shown < cut.wanted;
  const drawnTo = isCut ? at(cut!.through) : b;
  const words = one || drawnTo.value === a.value ? a.label : `${a.label} → ${drawnTo.label}`;
  const count = Math.max(1, b.value - a.value + 1);

  const commit = (f: number, g: number) => {
    const lo = Math.min(f, g);
    const hi = Math.max(f, g);
    /* the window never runs past the ceiling: Through gives way to From */
    onChange(lo, Math.min(hi, lo + ceiling - 1));
  };
  const pickDay = (d: Date) => {
    const hit = byDay.get(isoDate(d));
    if (!hit) return;
    if (side === 'from') commit(hit.value, Math.max(hit.value, through));
    else commit(Math.min(from, hit.value), hit.value);
  };
  /* with Through armed a day past the ceiling stays dim; From is free (Through follows it) */
  const dim = (d: Date) => {
    const hit = byDay.get(isoDate(d));
    if (!hit) return true;
    if (side === 'through') return hit.value - from + 1 > ceiling && hit.value >= from;
    return false;
  };
  const inWindow = (d: Date) => {
    const hit = byDay.get(isoDate(d));
    return !!hit && hit.value >= from && hit.value <= through;
  };
  const armed = side === 'from' ? a.date : b.date;

  return (
    <Popover.Root
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (o) setSide('through');
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          data-dropdown={testId ?? label}
          data-expiry-card
          data-expiry-range={`${from}-${through}`}
          aria-label={`${label}: ${words}${isCut ? ` · ${cut!.shown} of ${cut!.wanted} fit` : ''}`}
          title={note ?? (bare ? label : undefined)}
          data-expiry-note={note ? '' : undefined}
          className={flat ? `${FLAT_DOOR} ${FLAT_OPEN} group` : 'group inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none'}
        >
          <CalendarDays className="w-3 h-3 shrink-0 text-textMuted" aria-hidden="true" data-dropdown-icon />
          {!bare && <span className={flat ? 'text-t11 text-textMuted' : 'text-t9 uppercase tracking-widest text-textMuted'}>{label}</span>}
          <span className="text-t11 font-semibold text-textPrimary whitespace-nowrap">{words}</span>
          {isCut && (
            <span className="text-t11 tnum text-textMuted whitespace-nowrap" data-expiry-cut={`${cut!.shown}/${cut!.wanted}`}>
              · {cut!.shown} of {cut!.wanted}
            </span>
          )}
          <ChevronDown className="w-3 h-3 text-textMuted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={12} className={`${CARD} p-3 outline-none w-[300px]`} data-dropdown-card={testId ?? label} data-date-picker>
          <div className="px-0.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{title ?? label}</div>
          {/* the shortcuts: a window in one press */}
          <div className="flex flex-wrap items-center gap-1.5 pb-2" data-range-shortcuts>
            {shortcuts.map(s => {
              const on = s.from === from && s.through === through;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    commit(s.from, s.through);
                    setOpen(false);
                  }}
                  aria-pressed={on}
                  title={s.hint}
                  className="shrink-0 h-6 px-2 rounded-full border text-t10 font-medium transition-colors"
                  style={on ? { background: SILVER_FILL, color: '#0a0a0a', borderColor: SILVER_FILL } : { color: 'rgb(var(--text-secondary))', borderColor: 'rgb(var(--border-muted))' }}
                  data-range-shortcut={s.label}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {/* the two rows: the armed one takes the next day clicked */}
          <div className="grid grid-cols-2 gap-1.5 pb-2" data-range-rows>
            {(['from', 'through'] as Side[]).map(s => {
              const day = s === 'from' ? a : b;
              const on = side === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  aria-pressed={on}
                  className={`flex items-baseline justify-between gap-2 h-8 px-2.5 rounded-md border font-mono transition-colors ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderSubtle hover:border-borderMuted'}`}
                  data-range-side={s}
                  data-range-armed={on || undefined}
                >
                  <span className="text-t8 uppercase tracking-widest text-textMuted">{s}</span>
                  <span className={`text-t11 font-semibold ${on ? 'text-silver' : 'text-textPrimary'}`}>{day.label}</span>
                </button>
              );
            })}
          </div>
          <DayPicker
            mode="single"
            selected={armed}
            onSelect={d => d && pickDay(d)}
            /* the grid opens on From's month — the near expiries first, whichever row is armed (a Through in the next
               month would open there and hide this week) */
            defaultMonth={a.date ?? t}
            disabled={d => d < t || dim(d)}
            modifiers={{ window: inWindow }}
            modifiersClassNames={{ window: '[&>button]:bg-silver/[0.14]' }}
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
            <p className="text-t10 text-textMuted">
              {count} {count === 1 ? 'expiry' : 'expiries'} · {ceilingWhy}
            </p>
            <p className="text-t10 text-textMuted whitespace-nowrap">The lit days are the book's expiries.</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default ExpiryRangeCard;
