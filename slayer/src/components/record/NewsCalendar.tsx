/*
==================================================
  SLAYER TERMINAL - THE MONTH
  (components/record/NewsCalendar.tsx)

  The Day's calendar as a month — the partner's,
  ported 2026-09-13 (Noah, with his screenshot: "i
  love it. i want that as well but it needs to
  match our type design and our already existing
  code").

  Left, the month: Sunday to Saturday, every day a
  cell, what prints on it as pills — the macro
  releases in their impact's ink, the earnings as
  the name with its slot in silver, the market's
  own dates in magenta — three to a cell and the
  rest counted. Right, the day in hand: everything
  on it in order, with the figures. Arrows walk the
  months; Today comes home; a click on a day opens
  it. The data is data/monthCalendar.ts.

  The house's inks, not the partner's: the pills'
  washes go through `alpha` (a token ink cannot
  take a hex suffix — the theme memory's trap), the
  picked day wears the silver edge every open row
  wears, today's number sits in the primary ink's
  round, and it all holds on the light terminal.
==================================================
*/

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { now } from '../../core/clock';
import { buildMonthCalendar, dayKeyOf, fdaStamp, setLiveEarnings, subscribeFda, type CalDay, type CalEvent } from '../../data/monthCalendar';
import { ensureEarnings, useEveryReportQuiet } from '../../data/earningsFeed';
import { useSeen } from './CoName';
import CardTabs from '../ui/CardTabs';
import CompanyLogo from '../ui/CompanyLogo';
import { SUPREME, alpha } from '../gex/paletteInk';
import { IMPACT_INK, ImpactLegend, ImpactMark } from './impactMark';

const SILVER = 'rgb(var(--silver))'; /* the silver token as an ink — deep steel on the light terminal */
const WARN = 'rgb(var(--warn))';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type KindPick = 'all' | 'macro' | 'earnings' | 'fda' | 'schedule' | 'post';
const KIND_OPTIONS: { value: KindPick; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'macro', label: 'Data' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'fda', label: 'FDA' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'post', label: 'Posts' },
];
/** The day panel's width, and a cell's height at rest */
export const CAL_DAY_W = 340;
export const CAL_CELL_H = 96;

const SCHEDULE = 'rgb(var(--text-primary))';
const POST = 'rgb(var(--text-secondary))';
/** A pill's ink: the print's impact, the name's silver, the market's own magenta, the FDA date, the schedule, a post */
const inkOf = (e: CalEvent) => (e.kind === 'earnings' ? SILVER : e.kind === 'market' ? SUPREME : e.kind === 'fda' ? WARN : e.kind === 'schedule' ? SCHEDULE : e.kind === 'post' ? POST : IMPACT_INK[e.impact]);
const longDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const Pill = ({ e, onOpen }: { e: CalEvent; onOpen: () => void }) => {
  const ink = inkOf(e);
  return (
    <button
      type="button"
      onClick={ev => {
        ev.stopPropagation();
        onOpen();
      }}
      className="w-full flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] text-left font-mono text-[9.5px] font-semibold overflow-hidden transition-[filter] hover:brightness-110"
      style={{ background: alpha(ink, 0.13), color: ink, boxShadow: `inset 2px 0 0 0 ${ink}` }}
      title={e.kind === 'earnings' ? `${e.ticker} reports ${e.time}${e.impliedMovePct ? ` · ±${e.impliedMovePct.toFixed(1)}% priced` : ''}` : e.kind === 'post' ? e.title : e.kind === 'schedule' ? `${e.time} · ${e.title}${e.note ? ` · ${e.note}` : ''}` : e.kind === 'fda' ? `${e.title}` : `${e.time} · ${e.title}${e.forecast ? ` · fcst ${e.forecast}` : ''}`}
      data-cal-pill={e.id}
      data-kind={e.kind}
    >
      {e.kind === 'earnings' && e.ticker ? (
        <>
          <CompanyLogo ticker={e.ticker} size={10} />
          <span className="truncate">{e.ticker}</span>
          <span className="ml-auto text-[8px] font-normal opacity-80 shrink-0">{e.slot}</span>
        </>
      ) : e.kind === 'fda' && e.ticker ? (
        <>
          <CompanyLogo ticker={e.ticker} size={10} />
          <span className="truncate">{e.ticker}</span>
          <span className="ml-auto text-[8px] font-normal opacity-80 shrink-0">FDA</span>
        </>
      ) : e.kind === 'schedule' ? (
        <>
          <span className="truncate">{e.title}</span>
          <span className="ml-auto text-[8px] font-normal opacity-80 shrink-0">{e.time}</span>
        </>
      ) : e.kind === 'post' ? (
        <>
          <span className="truncate">{e.title}</span>
          <span className="ml-auto text-[8px] font-normal opacity-80 shrink-0">{e.time}</span>
        </>
      ) : (
        <>
          <span className="truncate">{e.title}</span>
          <span className="ml-auto text-[8px] font-normal opacity-80 shrink-0">{e.time}</span>
        </>
      )}
    </button>
  );
};

const NewsCalendar = () => {
  const today = useMemo(() => now(), []);
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [kind, setKind] = useState<KindPick>('all');
  const fdaRev = useSyncExternalStore(subscribeFda, fdaStamp, fdaStamp);
  /* the earnings are the Earnings page's own fortnight — one date per name across the Dossier */
  /* THE FORTNIGHT ONCE THE CALENDAR IS ON SCREEN (round 9: the News page read ~25 earnings-calendar pages at load, mostly
     for the "Next print" chip, which now reads only today's and the next session's lists) */
  const [calRef, calSeen] = useSeen<HTMLDivElement>();
  useEffect(() => {
    if (calSeen) ensureEarnings();
  }, [calSeen]);
  const reportsQ = useEveryReportQuiet();
  const reports = reportsQ.events;
  /* the day's empty line waits for the fortnight's reports to land (audit round 7: "nothing" before the read was in) */
  const reportsPending = reportsQ.status === 'loading';
  useEffect(() => {
    setLiveEarnings(
      reports
        .filter(r => r.iso && r.known)
        .map(r => {
          const [y, m, d] = (r.iso as string).split('-').map(Number);
          return {
            id: `er-${r.ticker}-${r.iso}`,
            kind: 'earnings' as const,
            date: new Date(y, m - 1, d, r.slot === 'BMO' ? 7 : 16, r.slot === 'BMO' ? 0 : 5),
            time: r.slot === 'BMO' ? 'before the open' : 'after the close',
            title: `${r.ticker} reports`,
            impact: r.impliedMovePct >= 7 ? ('high' as const) : r.impliedMovePct >= 4 ? ('medium' as const) : ('low' as const),
            ticker: r.ticker,
            slot: r.slot,
            confirmed: r.confirmed,
            impliedMovePct: r.impliedMovePct || undefined,
          };
        })
    );
  }, [reports]);
  const cal = useMemo(() => buildMonthCalendar(ym.y, ym.m), [ym, fdaRev]);
  const [pickedKey, setPickedKey] = useState(dayKeyOf(today));
  const days = useMemo(() => cal.weeks.flat(), [cal]);
  const picked: CalDay = days.find(d => d.key === pickedKey) ?? days.find(d => d.today) ?? days.find(d => d.inMonth)!;
  const keep = (e: CalEvent) => (kind === 'post' ? e.kind === 'post' : kind === 'all' ? e.kind !== 'post' : kind === 'macro' ? e.kind === 'macro' || e.kind === 'market' : e.kind === kind);
  /* a month walked lands on today when it is that month, else on its first */
  const shift = (by: number) => {
    const d = new Date(ym.y, ym.m + by, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
    setPickedKey(dayKeyOf(sameMonth(d, today) ? today : d));
  };
  const home = () => {
    setYm({ y: today.getFullYear(), m: today.getMonth() });
    setPickedKey(dayKeyOf(today));
  };
  const highCount = cal.events.filter(e => e.impact === 'high' && e.kind === 'macro').length;
  const erCount = cal.events.filter(e => e.kind === 'earnings').length;
  const fdaCount = cal.events.filter(e => e.kind === 'fda').length;
  const schedCount = cal.events.filter(e => e.kind === 'schedule').length;
  const postCount = cal.events.filter(e => e.kind === 'post').length;
  const dayEvents = picked.events.filter(keep);

  /* The day beside the month from md; under it on a phone, where the head row wraps too (the phone pass, 2026-09-13) */
  return (
    <div
      ref={calRef}
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_var(--cal-day-w)]"
      style={{ '--cal-day-w': `${CAL_DAY_W}px` } as CSSProperties}
      data-news-calendar
      data-month={`${ym.y}-${ym.m + 1}`}
    >
      {/* The kind of date — its own row, across the month and the day, so five tabs never sit on the cells */}
      <div className="col-span-full px-4 min-h-[36px] py-1.5 flex items-center gap-x-4 gap-y-1 border-b border-borderSubtle flex-wrap" data-cal-kinds>
        <CardTabs options={KIND_OPTIONS} value={kind} onChange={setKind} ariaLabel="What the calendar shows" />
        <span className="ml-auto">
          <ImpactLegend />
        </span>
      </div>
      {/* THE MONTH */}
      <div className="min-w-0 border-r border-borderSubtle max-lg:border-r-0 max-lg:border-b">
        <div className="px-4 h-[40px] flex items-center gap-2 border-b border-borderSubtle max-lg:h-auto max-lg:py-2 max-lg:flex-wrap">
          <button type="button" onClick={() => shift(-1)} className="inline-flex items-center justify-center w-6 h-6 rounded text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" title="The month before" aria-label="The month before" data-cal-prev>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => shift(1)} className="inline-flex items-center justify-center w-6 h-6 rounded text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" title="The month after" aria-label="The month after" data-cal-next>
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-[14px] font-semibold text-textPrimary" data-cal-label>
            {cal.label}
          </span>
          <button type="button" onClick={home} className="inline-flex items-center h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-cal-today>
            Today
          </button>
          <span className="font-mono text-[10px] tnum text-textSecondary ml-2 truncate" data-cal-counts>
            {highCount} high · {erCount} reports · {fdaCount} FDA{schedCount ? ` · ${schedCount} on the schedule` : ''}{postCount ? ` · ${postCount} posts` : ''}
          </span>
        </div>
        <div className="grid grid-cols-7 border-b border-borderSubtle/60">
          {WEEKDAYS.map(w => (
            <div key={w} className="px-2 h-[22px] flex items-center font-mono text-[9px] uppercase tracking-widest text-textMuted">
              {w}
            </div>
          ))}
        </div>
        {cal.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-borderSubtle/40 last:border-b-0" data-cal-week={wi}>
            {week.map(day => {
              const events = day.events.filter(keep);
              const isPicked = day.key === picked.key;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={day.key}
                  onClick={() => setPickedKey(day.key)}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') setPickedKey(day.key);
                  }}
                  className={`relative cursor-pointer px-1.5 pt-1 pb-1.5 text-left border-r border-borderSubtle/40 last:border-r-0 flex flex-col gap-[3px] transition-colors ${isPicked ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.04]'} ${!day.inMonth ? 'opacity-45' : ''} ${day.weekend && day.inMonth && !isPicked ? 'bg-ink/[0.015]' : ''}`}
                  style={{ height: CAL_CELL_H, overflow: 'hidden' }}
                  data-cal-day={day.key}
                  data-picked={isPicked || undefined}
                  data-today={day.today || undefined}
                  aria-pressed={isPicked}
                >
                  <span className={`self-start inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full font-mono text-[11px] tnum ${day.today ? 'bg-textPrimary text-panel font-bold' : 'text-textPrimary'}`}>{day.date.getDate()}</span>
                  {events.slice(0, 3).map(e => (
                    <Pill key={e.id} e={e} onOpen={() => setPickedKey(day.key)} />
                  ))}
                  {events.length > 3 && <span className="font-mono text-[9px] text-textMuted pl-1">{events.length - 3} more</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* THE DAY IN HAND */}
      <div className="min-w-0 flex flex-col" data-cal-day-panel={picked.key}>
        <div className="px-4 h-[40px] flex items-center gap-2 border-b border-borderSubtle">
          <span className="text-[13px] font-semibold text-textPrimary">{longDay(picked.date)}</span>
          {picked.today && <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-select">today</span>}
          <span className="ml-auto font-mono text-[10px] tnum text-textSecondary">
            {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[560px]">
          {dayEvents.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{reportsPending ? 'Reading the calendar' : 'Nothing on the record for this day'}</div>
          ) : (
            dayEvents.map(e => (
              <div key={e.id} className="px-4 py-2 border-b border-borderSubtle/40" data-cal-event={e.id} data-kind={e.kind}>
                <div className="flex items-start gap-2">
                  {e.kind === 'earnings' ? <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: SILVER }} /> : e.kind === 'market' ? <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: SUPREME }} /> : e.kind === 'fda' ? <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: WARN }} /> : e.kind === 'schedule' ? <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: SCHEDULE }} /> : e.kind === 'post' ? <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: POST }} /> : <ImpactMark tier={e.impact} />}
                  <span className="font-mono text-[10px] tnum text-textSecondary w-[54px] shrink-0">{e.kind === 'earnings' ? (e.slot === 'BMO' ? 'pre' : 'post') : e.kind === 'fda' ? 'FDA' : e.time}</span>
                  {e.kind === 'earnings' && e.ticker ? (
                    <span className="min-w-0 flex items-center gap-1.5 text-[12px] text-textPrimary">
                      <CompanyLogo ticker={e.ticker} size={14} />
                      <span className="font-mono font-bold">{e.ticker}</span> reports {e.time}
                    </span>
                  ) : e.kind === 'fda' && e.ticker ? (
                    <span className="min-w-0 flex items-center gap-1.5 text-[12px] text-textPrimary">
                      <CompanyLogo ticker={e.ticker} size={14} />
                      <span className="font-mono font-bold">{e.ticker}</span>
                      <span className="break-words whitespace-normal leading-relaxed">{e.note}</span>
                    </span>
                  ) : (
                    <span className={`min-w-0 break-words whitespace-normal leading-relaxed text-[12px] text-textPrimary ${e.kind === 'post' ? '' : e.impact === 'high' ? 'font-semibold' : ''}`}>{e.title}</span>
                  )}
                  {e.region && <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-textMuted">{e.region}</span>}
                </div>
                {e.kind !== 'post' && (
                <div className="mt-1 pl-[72px] flex items-center gap-x-4 font-mono text-[10px] tnum text-textPrimary">
                  {e.kind === 'earnings' ? (
                    <>
                      {e.impliedMovePct != null && <span>±{e.impliedMovePct.toFixed(1)}% priced for the print</span>}
                      <span className="text-textMuted">{e.confirmed ? 'date confirmed by the company' : 'date estimated — not yet confirmed'}</span>
                    </>
                  ) : e.kind === 'fda' || e.kind === 'schedule' ? (
                    <span className="min-w-0 break-words whitespace-normal leading-relaxed text-textMuted">{e.note ?? (e.kind === 'fda' ? 'an FDA date' : '')}</span>
                  ) : (
                    <>
                      {e.forecast && (
                        <span>
                          <span className="text-textMuted">fcst</span> {e.forecast}
                        </span>
                      )}
                      {e.previous && (
                        <span>
                          <span className="text-textMuted">prev</span> {e.previous}
                        </span>
                      )}
                      {!e.forecast && !e.previous && <span className="text-textMuted">{e.kind === 'market' ? 'the market’s own date' : 'no forecast on the feed'}</span>}
                    </>
                  )}
                </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default NewsCalendar;
