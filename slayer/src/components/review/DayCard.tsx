/* REVIEW · the day card — a labelled card like every other on a line (DropdownSelect's clothes), opening the house
   calendar (ExpiryPicker's) on the sessions ThetaData's quote history holds: from the oldest it reaches to the newest
   finished one. A day outside that cannot be picked, nor one before `min` (the desk's clock only moves forward). */

import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { CARD } from '../ui/DropdownSelect';
import { isoDate } from '../../core/calendar';
import { dateOf, dayWords, ensureWindow, historyRev, isReplayDay, replayWindow, subscribeHistory } from '../../data/review/history';

interface Props {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  /** The earliest day that may be picked */
  min?: string;
  title?: string;
  testId?: string;
  size?: 'md' | 'sm';
}

const DayCard = ({ label, value, onChange, min, title, testId, size = 'md' }: Props) => {
  const [open, setOpen] = useState(false);
  useSyncExternalStore(subscribeHistory, historyRev, historyRev);
  useEffect(() => {
    void ensureWindow();
  }, []);
  const w = replayWindow();
  const floor = min ?? w.first ?? '';
  const selected = dateOf(value);
  const oldest = w.first ? dateOf(w.first) : (() => {
    const d = dateOf(w.last);
    d.setFullYear(d.getFullYear() - 1);
    return d;
  })();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={title}
          data-dropdown={testId ?? label}
          className={`group inline-flex items-center gap-1.5 ${size === 'sm' ? 'h-6 px-2' : 'h-7 px-2.5'} rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none`}
        >
          <CalendarDays className="w-3 h-3 shrink-0 text-textMuted" aria-hidden="true" />
          {label && <span className="shrink-0 text-t9 uppercase tracking-widest text-textMuted">{label}</span>}
          <span className="text-t11 font-semibold text-textPrimary whitespace-nowrap">{dayWords(value, true).replace(/, \d{4}$/, '')}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className={`${CARD} p-3 outline-none w-[288px]`} data-day-card={testId ?? label}>
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={d => {
              if (!d) return;
              onChange(isoDate(d));
              setOpen(false);
            }}
            defaultMonth={selected}
            startMonth={oldest}
            endMonth={dateOf(w.last)}
            disabled={d => {
              const iso = isoDate(d);
              return !isReplayDay(iso) || iso < floor;
            }}
            showOutsideDays
            weekStartsOn={0}
            components={{ Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) }}
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
              today: '',
              outside: '[&>button]:text-textMuted/40',
              disabled: '[&>button]:text-textMuted/30 [&>button]:cursor-not-allowed [&>button:hover]:bg-transparent',
              hidden: 'invisible',
              focused: '',
            }}
          />
          <p className="mt-2 pt-2 border-t border-borderSubtle/70 text-t10 text-textMuted" data-day-card-window>
            {w.first ? `Recorded sessions, ${dayWords(w.first, true).replace(/^\w+, /, '')} to ${dayWords(w.last, true).replace(/^\w+, /, '')}` : `Recorded sessions up to ${dayWords(w.last, true).replace(/^\w+, /, '')} — how far back the quotes reach is being checked`}
            {min ? ', from where the clock stands' : ''}.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default DayCard;
