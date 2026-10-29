/*
==================================================
  SLAYER TERMINAL - THE JOURNAL'S MONTH
  (components/review/JournalMonth.tsx)

  The first thing the journal shows (Noah, 2026-09-25:
  "i love the calendar view as the first thing that
  greets you and thats what i want"; 2026-09-26, on the
  first cut: "the calendar should be the nice curved
  corners … remember my previous say about how i wanted
  to calendar to look"). His reference — the partner's
  journal — laid the month as CARDS: a rounded box a day,
  air between them, Sunday to Saturday, and a column for
  each week's total. This is that, in the house's inks:

    a day        a rounded card; its number top left; a
                 day that closed something wears WHAT IT
                 MADE — its figure in its ink, its ground
                 and edge washed in it, deeper the bigger
                 the day against the month's biggest — and
                 how many closed and won; A SMALL PEN where
                 it has words of its own (a dot at first —
                 Noah, 2026-09-26: "why do some of these
                 have a little circle on them" → "use the
                 pen": a mark that is not a figure has to
                 say what it is)
    today        its edge in silver, and the word
    the open day a silver ring
    the week     its own card at the row's end, the week's
                 total and how many closed

  A day is THE CALENDAR DAY the trade closed on, New
  York's (journalFigures.ts). The arrows walk the months,
  "This month" comes home.
==================================================
*/

import { ChevronLeft, ChevronRight, PenLine } from 'lucide-react';
import { card } from './DeskShell';
import { dirInk, pct, usdSigned } from './words';
import { monthWeeks, monthWords, shiftMonth, type DayTotal } from '../../data/review/journalFigures';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* THE CARDS KEEP A SHAPE (2026-10-03 — Noah, with his partner's month beside ours: "in box sizing what is the difference
   between my cards and my partners cards, i think his look better"): ours stretched to fill the box, 177 wide by 82 tall at
   1905 — a slab beside his 150 by 82. A day is 11:6 whatever the width now (wider screen, taller card), the cards sit 8px
   apart, and the number stands top-left on EVERY day — a button centres a lone line, so the empty days' numbers sat
   mid-card while the full days' sat at the top.

   THE SHAPE IS THE ROW'S, NOT THE CARD'S. CSS aspect-ratio on a grid item is a trap both ways: a height floor on it becomes
   a width floor (the grid overflowed at 1440), and a stretched height becomes a width (the same). So the board is a size
   container and each week row's height is computed from the board's width — a day's width (eight columns, seven 8px gaps,
   the week column 0.85 of a day) times 6/11 — never under 80px, where three lines must fit on a narrow day. */
const GRID = 'grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(84px,0.85fr)] gap-2';
const ROWS = '[grid-auto-rows:max(80px,calc((100cqw_-_56px)/7.85*0.5455))]';
const door = 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors';

/** How deep a day's wash is: a little for any day, most for the month's biggest — eased, so a small day still shows */
const washOf = (net: number, biggest: number): number => (biggest > 0 ? 0.1 + 0.26 * Math.pow(Math.min(1, Math.abs(net) / biggest), 0.6) : 0);

interface Props {
  month: string;
  onMonth: (month: string) => void;
  /** The month the clock is in — "This month" brings it back */
  home: string;
  days: Map<string, DayTotal>;
  today: string;
  /** The day that is open */
  picked: string | null;
  onPick: (day: string | null) => void;
  /** Days with words of their own */
  noted: ReadonlySet<string>;
}

const JournalMonth = ({ month, onMonth, home, days, today, picked, onPick, noted }: Props) => {
  const weeks = monthWeeks(month);
  const inMonth = [...days.values()].filter(d => d.day.startsWith(month));
  const net = inMonth.reduce((x, d) => x + d.net, 0);
  const trades = inMonth.reduce((x, d) => x + d.n, 0);
  const green = inMonth.filter(d => d.net > 0).length;
  const biggest = Math.max(0, ...inMonth.map(d => Math.abs(d.net)));
  const monthName = monthWords(month).split(' ')[0];

  return (
    <div className={`${card} flex flex-col min-w-0 h-full`} data-journal-month={month}>
      <div className="px-5 pt-3.5 pb-2.5 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => onMonth(shiftMonth(month, -1))} title="The month before" aria-label="The month before" className={door} data-journal-month-prev>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="min-w-[140px] text-center text-t15 font-semibold text-textPrimary" data-journal-month-name>
          {monthWords(month)}
        </span>
        <button type="button" onClick={() => onMonth(shiftMonth(month, 1))} title="The month after" aria-label="The month after" className={door} data-journal-month-next>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        {month !== home && (
          <button type="button" onClick={() => onMonth(home)} className="h-7 px-2.5 rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-journal-month-home>
            This month
          </button>
        )}
        <span className="ml-auto font-mono text-t11 tnum text-textSecondary whitespace-nowrap" data-journal-month-sum>
          {trades === 0 ? (
            <span className="text-textMuted">Nothing closed this month</span>
          ) : (
            <>
              <span className="text-textMuted">{monthName}</span> <span className={`text-t13 font-semibold ${dirInk(net)}`}>{usdSigned(net, 0)}</span>
              <span className="text-textMuted">
                {' '}
                · {trades} {trades === 1 ? 'trade' : 'trades'} · {green} of {inMonth.length} {inMonth.length === 1 ? 'day' : 'days'} made money
              </span>
            </>
          )}
        </span>
      </div>
      {/* on a phone the board scrolls sideways inside its box at a readable width (the Earnings board's rule) */}
      <div className="px-3 pb-3 flex-1 flex flex-col max-lg:overflow-x-auto">
        <div className="max-lg:min-w-[760px] flex flex-col gap-2 [container-type:inline-size]">
          <div className={GRID}>
            {[...WEEKDAYS, 'Week'].map(w => (
              <div key={w} className={`px-2.5 h-6 flex items-center font-mono text-t9 font-semibold uppercase tracking-widest text-gridHead ${w === 'Week' ? 'justify-end' : ''}`}>
                {w}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => {
            const wk = week.filter((d): d is string => !!d).map(d => days.get(d)).filter((d): d is DayTotal => !!d);
            const wNet = wk.reduce((x, d) => x + d.net, 0);
            const wN = wk.reduce((x, d) => x + d.n, 0);
            return (
              <div key={wi} className={`${GRID} ${ROWS}`} data-journal-week={wi}>
                {week.map((d, di) => {
                  if (!d) return <div key={di} aria-hidden="true" />;
                  const t = days.get(d);
                  const on = d === picked;
                  const isToday = d === today;
                  const future = d > today;
                  const wash = t ? washOf(t.net, biggest) : 0;
                  const ink = t ? (t.net > 0 ? 'bull' : t.net < 0 ? 'bear' : null) : null;
                  const date = new Date(`${d}T12:00:00`);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onPick(on ? null : d)}
                      aria-pressed={on}
                      title={`${DAYS[date.getDay()]}, ${monthName} ${date.getDate()} — ${t ? `${t.n} closed, ${usdSigned(t.net)}` : future ? 'still to come' : 'nothing closed'} · ${on ? 'close the day' : 'open the day'}`}
                      className={`relative min-h-0 rounded-lg border px-3 py-2 text-left flex flex-col items-stretch justify-start transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-silver/60 ${on ? 'ring-2 ring-silver border-transparent' : isToday ? 'border-silver/60' : 'border-borderSubtle hover:border-borderMuted'} ${!t ? 'hover:bg-ink/[0.03]' : ''}`}
                      style={ink ? { background: `rgb(var(--${ink}) / ${wash.toFixed(3)})`, borderColor: on ? undefined : `rgb(var(--${ink}) / ${(0.3 + wash).toFixed(3)})` } : undefined}
                      data-journal-day={d}
                      data-trades={t?.n ?? 0}
                      data-on={on || undefined}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`font-mono text-t12 font-bold tnum ${isToday || on ? 'text-silver' : t ? 'text-textPrimary' : future ? 'text-textMuted/50' : 'text-textSecondary'}`}>{date.getDate()}</span>
                        {isToday && <span className="font-mono text-t8 font-semibold uppercase tracking-widest text-silver">Today</span>}
                        {noted.has(d) && <PenLine className="ml-auto w-3 h-3 text-silver" strokeWidth={2} aria-label="This day has words of its own" data-journal-day-noted />}
                      </span>
                      {t && (
                        <span className="mt-1.5 block">
                          <span className={`block font-mono text-t14 font-semibold tnum leading-none ${dirInk(t.net)}`}>{usdSigned(t.net, 0)}</span>
                          {/* the two halves wrap as wholes on a narrow month */}
                          <span className="mt-1 block font-mono text-t9 tnum text-textMuted leading-snug">
                            <span className="whitespace-nowrap">
                              {t.n} {t.n === 1 ? 'trade' : 'trades'} ·
                            </span>{' '}
                            <span className="whitespace-nowrap">{pct(t.wins / t.n)} won</span>
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* THE WEEK: what its days in this month made, a card of its own */}
                <div className="rounded-lg border border-borderSubtle bg-ink/[0.025] px-3 py-2 flex flex-col items-end justify-center text-right" title={`This week's days in ${monthName}`} data-journal-week-sum={wN}>
                  {wN > 0 ? (
                    <>
                      <span className={`font-mono text-t14 font-semibold tnum leading-none ${dirInk(wNet)}`}>{usdSigned(wNet, 0)}</span>
                      <span className="mt-1.5 font-mono text-t9 tnum text-textMuted">
                        {wN} {wN === 1 ? 'trade' : 'trades'}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-t11 text-textMuted/60">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default JournalMonth;
