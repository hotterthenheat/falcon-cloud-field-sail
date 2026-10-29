/* The journal's month as cards, Sunday to Saturday with a column for each week's total; a day that closed
   something wears what it made in its ink. The journal's own copy of components/review/JournalMonth, for both kinds of
   journal: the app's measured trades, and the reader's own entries (a day may carry a P&L and no count). A week with
   nothing in it says so quietly instead of drawing an empty box. */

import { ChevronLeft, ChevronRight, PenLine } from 'lucide-react';
import { card } from '../../components/review/DeskShell';
import { dirInk, pct, usdSigned } from '../../components/review/words';
import { monthWeeks, monthWords, shiftMonth } from '../../data/review/journalFigures';
import type { BarDay } from './JournalBars';

type DayTotal = BarDay;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* The cards keep a shape: ours stretched to fill the box, 177 wide by 82 tall at 1905 — a slab beside his 150 by
   82. */
const GRID = 'grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(84px,0.85fr)] gap-2';
const ROWS = '[grid-auto-rows:max(80px,calc((100cqw_-_56px)/7.85*0.5455))]';
const door = 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors';

/** "+1.2K" · "−340" — a day's result in the width of a phone's cell */
const compact = (v: number): string => {
  const a = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}K` : a.toFixed(0)}`;
};
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
  /** The reader's own entries: "entered", not "closed" */
  entered?: boolean;
}

const JournalCalendar = ({ month, onMonth, home, days, today, picked, onPick, noted, entered = false }: Props) => {
  const verb = entered ? 'entered' : 'closed';
  const weeks = monthWeeks(month);
  const inMonth = [...days.values()].filter(d => d.day.startsWith(month));
  const net = inMonth.reduce((x, d) => x + d.net, 0);
  const trades = inMonth.reduce((x, d) => x + d.n, 0);
  const any = inMonth.length > 0;
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
          {!any ? (
            <span className="text-textMuted">Nothing {verb} this month</span>
          ) : (
            <>
              <span className="text-textMuted">{monthName}</span> <span className={`text-t13 font-semibold ${dirInk(net)}`}>{usdSigned(net, 0)}</span>
              <span className="text-textMuted">
                {' '}
                {trades > 0 && ` · ${trades} ${trades === 1 ? 'trade' : 'trades'}`} · {green} of {inMonth.length} {inMonth.length === 1 ? 'day' : 'days'} made money
              </span>
            </>
          )}
        </span>
      </div>
      {/* ON A PHONE: seven narrow days a row, each its date and what it made, the week's sum under the row */}
      <div className="sm:hidden px-2 pb-3 flex flex-col gap-1" data-journal-month-phone>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map(w => (
            <div key={w} className="h-5 flex items-center justify-center font-mono text-t8 font-semibold uppercase tracking-wider text-gridHead">
              {w.slice(0, 2)}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => {
          const wk = week.filter((d): d is string => !!d).map(d => days.get(d)).filter((d): d is DayTotal => !!d);
          const wNet = wk.reduce((x, d) => x + d.net, 0);
          return (
            <div key={wi} className="flex flex-col gap-0.5">
              <div className="grid grid-cols-7 gap-1">
                {week.map((d, di) => {
                  if (!d) return <div key={di} aria-hidden="true" />;
                  const t = days.get(d);
                  const on = d === picked;
                  const ink = t ? (t.net > 0 ? 'bull' : t.net < 0 ? 'bear' : null) : null;
                  const wash = t ? washOf(t.net, biggest) : 0;
                  const date = new Date(`${d}T12:00:00`);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onPick(on ? null : d)}
                      aria-pressed={on}
                      aria-label={`${DAYS[date.getDay()]}, ${monthName} ${date.getDate()} — ${t ? `${t.n ? `${t.n} ${verb}, ` : ''}${usdSigned(t.net)}` : `nothing ${verb}`}`}
                      className={`h-11 min-w-0 rounded-md border flex flex-col items-center justify-center gap-0.5 ${on ? 'ring-2 ring-silver border-transparent' : d === today ? 'border-silver/60' : 'border-borderSubtle'}`}
                      style={ink ? { background: `rgb(var(--${ink}) / ${wash.toFixed(3)})` } : undefined}
                      data-journal-day={d}
                    >
                      <span className={`font-mono text-t10 font-bold tnum ${d === today || on ? 'text-silver' : t ? 'text-textPrimary' : 'text-textMuted'}`}>{date.getDate()}</span>
                      {t && <span className={`font-mono text-t8 font-semibold tnum leading-none ${dirInk(t.net)}`}>{compact(t.net)}</span>}
                    </button>
                  );
                })}
              </div>
              {wk.length > 0 && (
                <div className="px-1 flex justify-end font-mono text-t9 tnum text-textMuted" data-journal-week-sum={wk.length}>
                  week <span className={`ml-1 font-semibold ${dirInk(wNet)}`}>{usdSigned(wNet, 0)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="max-sm:hidden px-3 pb-3 flex-1 flex flex-col max-lg:overflow-x-auto">
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
            const firstDay = week.find((d): d is string => !!d)!;
            const weekAhead = firstDay > today;
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
                      title={`${DAYS[date.getDay()]}, ${monthName} ${date.getDate()} — ${t ? `${t.n ? `${t.n} ${verb}, ` : ''}${usdSigned(t.net)}` : future ? 'still to come' : `nothing ${verb}`} · ${on ? 'close the day' : 'open the day'}`}
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
                            {t.n > 0 ? (
                              <>
                                <span className="whitespace-nowrap">
                                  {t.n} {t.n === 1 ? 'trade' : 'trades'} ·
                                </span>{' '}
                                <span className="whitespace-nowrap">{pct(t.wins / t.n)} won</span>
                              </>
                            ) : (
                              <span className="whitespace-nowrap">P&amp;L only</span>
                            )}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* THE WEEK: what its days in this month made, a card of its own — a week with nothing in it is no box
                    at all, a quiet word ("no trades"), and a week still ahead is left blank */}
                {wk.length > 0 ? (
                  <div className="rounded-lg border border-borderSubtle bg-ink/[0.025] px-3 py-2 flex flex-col items-end justify-center text-right" title={`This week's days in ${monthName}`} data-journal-week-sum={wk.length}>
                    <span className={`font-mono text-t14 font-semibold tnum leading-none ${dirInk(wNet)}`}>{usdSigned(wNet, 0)}</span>
                    <span className="mt-1.5 font-mono text-t9 tnum text-textMuted">
                      {wN > 0 ? `${wN} ${wN === 1 ? 'trade' : 'trades'}` : `${wk.length} ${wk.length === 1 ? 'day' : 'days'}`}
                    </span>
                  </div>
                ) : (
                  <div className="px-3 py-2 flex items-center justify-end text-right font-mono text-t9 uppercase tracking-wider text-textMuted/70" data-journal-week-sum={0} data-journal-week-empty={weekAhead ? 'ahead' : 'none'}>
                    {weekAhead ? '' : entered ? 'nothing entered' : 'no trades'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default JournalCalendar;
