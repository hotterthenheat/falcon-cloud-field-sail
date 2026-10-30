/* A JOURNAL OF YOUR OWN: the reader's real trading from their own broker, entered a day at a time (and, if they like,
   a trade at a time) or brought in from a CSV — on the same month, figures and charts as the app's journals, and
   labelled everywhere as entered by you: the app measured none of it. The store and the figures are
   data/review/journalManual.ts, with the CSV format at its head. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, FileUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import TraceBox, { Fact, TraceGrid } from '../../components/trace/TraceBox';
import SessionsChart, { type ChartPoint } from '../../components/record/SessionsChart';
import type { Column } from '../../components/ui/DataTable';
import { EmptyBox } from '../../components/ui/states';
import { undoable } from '../../components/ui/undo';
import { card, headWord } from '../../components/review/DeskShell';
import { dirInk, pct, usd, usdSigned } from '../../components/review/words';
import { fmtDayLocal } from '../../components/gex/chartTime';
import JournalCalendar from './JournalCalendar';
import JournalBars, { countWords } from './JournalBars';
import { EndDoors, JournalPicker, PeriodPick, door, saveFile } from './JournalPicker';
import { PERIODS, isPeriod, monthOf, monthWords, spanOf, type Period } from '../../data/review/journalFigures';
import { pickOf, searchWithPick, type JournalPick } from '../../data/review/journalBooks';
import {
  CSV_DAYS_EXAMPLE,
  CSV_TRADES_EXAMPLE,
  addManualTrade,
  createManualJournal,
  deleteManualDay,
  deleteManualJournal,
  deleteManualTrade,
  importManual,
  manualDaysCsv,
  manualDaysOf,
  manualRunningOf,
  manualStatsOf,
  manualTradesCsv,
  numberOf,
  putManualJournal,
  readJournalCsv,
  readManualJournals,
  renameManualJournal,
  setManualDay,
  tradePnlOf,
  useManualJournals,
  type CsvRead,
  type ManualDay,
  type ManualDayFigure,
  type ManualJournal,
  type ManualSide,
  type ManualTrade,
} from '../../data/review/journalManual';
import { nyAt } from '../../data/paper/clock';
import { MONTHS } from '../../core/calendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const chartHead = 'px-5 pt-4 pb-3 flex items-baseline gap-3 flex-wrap';
const field = 'w-full min-w-0 h-10 sm:h-8 px-2.5 rounded-md border border-borderSubtle bg-chip font-mono text-t12 tnum text-textPrimary placeholder:text-textMuted outline-none focus:border-silver/60 transition-colors';
const label = 'font-mono text-t9 uppercase tracking-widest text-textMuted';
/** A day's moment on the charts' clock — noon in New York, a point a day */
const dayTime = (day: string) => Math.floor(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 16) / 1000);
const prevDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** The label every figure of these journals wears */
export const EnteredChip = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center h-5 px-1.5 rounded border border-warn/40 font-mono text-t9 uppercase tracking-widest text-warn whitespace-nowrap ${className}`} title="These numbers are what you entered from your own broker — the app has not measured or checked them" data-journal-entered>
    Entered by you
  </span>
);

export const JournalManualHome = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const all = useManualJournals();
  const q = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const pick = pickOf(location.search);
  const period: Period = isPeriod(q.get('period')) ? (q.get('period') as Period) : 'month';
  const picked = ISO_DAY.test(q.get('day') ?? '') ? q.get('day') : null;
  const today = nyAt(Date.now()).date;
  const home = monthOf(today);
  const month = ISO_MONTH.test(q.get('month') ?? '') ? q.get('month')! : picked ? monthOf(picked) : home;

  /* the journal(s) on the page: the one named, or all of them — one alone is the one */
  const one = pick.id ? (all.find(j => j.id === pick.id) ?? null) : all.length === 1 ? all[0] : null;
  const missing = pick.id != null && !one;
  const journals = useMemo(() => (one ? [one] : missing ? [] : all), [one, missing, all]);
  const creating = q.get('new') === '1' || all.length === 0;
  const [importing, setImporting] = useState(q.get('import') === '1');
  /* a link to `?journal=manual&import=1` (the journal's "Import a CSV" door) opens the import, even on this page */
  const importAsked = q.get('import') === '1';
  useEffect(() => {
    if (importAsked) setImporting(true);
  }, [importAsked]);
  const closeImport = () => {
    setImporting(false);
    if (importAsked) set({ import: null });
  };
  const [editing, setEditing] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    navigate({ search: s ? `?${s}` : '' }, { replace: true });
  };
  const pickJournal = (p: JournalPick) => navigate({ search: searchWithPick(location.search, p, ['day', 'month', 'new']) }, { replace: true });
  const openDay = (day: string | null) => set({ day, month: day && monthOf(day) !== home ? monthOf(day) : day ? null : q.get('month') });

  /* ---- the figures ---- */
  const days = useMemo(() => manualDaysOf(journals), [journals]);
  const span = spanOf(period, today);
  const periodDays = useMemo(() => [...days.values()].filter(d => !span || (d.day >= span.from && d.day <= span.to)), [days, period, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => manualStatsOf(periodDays), [periodDays]);
  const run = useMemo(() => manualRunningOf(periodDays), [periodDays]);
  const runBy = useMemo(() => new Map(run.map(p => [dayTime(p.day), p])), [run]);
  const runPoints = useMemo<ChartPoint[]>(() => (run.length ? [{ time: dayTime(prevDay(run[0].day)), value: 0 }, ...run.map(p => ({ time: dayTime(p.day), value: p.value }))] : []), [run]);
  const runRange = useMemo(() => [Math.min(0, ...run.map(p => p.value)), Math.max(0, ...run.map(p => p.value))] as const, [run]);
  const noted = useMemo(() => {
    const out = new Set<string>();
    for (const j of journals) for (const [d, e] of Object.entries(j.days)) if (e.notes?.trim() || e.tags?.length) out.add(d);
    return out;
  }, [journals]);
  const periodTrades = useMemo(() => periodDays.flatMap(d => d.trades.map(t => ({ t, j: journals.find(x => x.trades.includes(t)) })).filter((x): x is { t: ManualTrade; j: ManualJournal } => !!x.j)).sort((a, b) => `${b.t.day} ${b.t.time ?? ''}`.localeCompare(`${a.t.day} ${a.t.time ?? ''}`)), [periodDays, journals]);

  const periodLabel = PERIODS.find(p => p.value === period)!.label;
  const title = one ? one.name : missing ? 'Journal not found' : creating && !all.length ? 'A journal of your own' : 'All your journals';
  const spanWords = !span ? 'Every day entered' : period === 'today' ? `${shortDay(today)} · New York’s day` : period === 'week' ? `${shortDay(span.from)} to ${shortDay(span.to)}` : period === 'month' ? monthWords(home) : today.slice(0, 4);

  const exportCsv = () => {
    if (!one) return;
    const slug = one.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'journal';
    saveFile(`slayer-my-journal-${slug}-days.csv`, manualDaysCsv(one));
    if (one.trades.length) window.setTimeout(() => saveFile(`slayer-my-journal-${slug}-trades.csv`, manualTradesCsv(one)), 300);
  };
  const csvWhyNot = !one ? (all.length > 1 ? 'pick one journal — a file is one journal’s' : 'nothing yet — make a journal first') : !Object.keys(one.days).length && !one.trades.length ? 'nothing yet — nothing entered in this journal' : null;
  const openNotes = () => {
    openDay(today);
    window.setTimeout(() => document.querySelector('[data-manual-day]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  };

  const pickedFigure = picked ? (days.get(picked) ?? null) : null;

  return (
    <div className="flex flex-col gap-3" data-journal-home="manual" data-period={period} data-journal-manual={one?.id ?? (missing ? 'missing' : 'all')}>
      <TraceBox
        title={title}
        sub={
          <span className="inline-flex items-center gap-2 max-w-full">
            <EnteredChip />
            <span className="truncate">
              {one?.broker ? `${one.broker} · ` : ''}
              {spanWords}
            </span>
          </span>
        }
        testId="manual-journal"
        data={{ days: periodDays.length }}
        facts={
          <>
            <Fact label="Made or lost" testId="journal-net" title="Your P&L less your fees, as you entered them">
              <span className={`text-t14 font-semibold ${dirInk(stats.net)}`}>{stats.days ? usdSigned(stats.net) : '—'}</span>
            </Fact>
            <Fact label="Days" testId="journal-days">{stats.days ? `${stats.greenDays} green · ${stats.redDays} red` : '—'}</Fact>
            <Fact label="Won" testId="journal-won" title="Your wins over your wins and losses, as entered">
              {stats.winRate != null ? `${stats.wins} of ${stats.wins + stats.losses} · ${pct(stats.winRate)}` : '—'}
            </Fact>
            <Fact label="Profit factor" title="What your green days made, over what your red days lost" testId="journal-pf">
              {!stats.days ? '—' : stats.dayProfitFactor == null ? (stats.greenDays ? 'no red days' : '—') : stats.dayProfitFactor.toFixed(2)}
            </Fact>
          </>
        }
        controls={
          <>
            <JournalPicker pick={pick} onPick={pickJournal} onNew={() => set({ new: '1' })} />
            <PeriodPick value={period} onChange={v => set({ period: v === 'month' ? null : v })} />
            <EndDoors
              onNotes={one ? openNotes : undefined}
              notesWord="Enter today"
              onCsv={exportCsv}
              csvWhyNot={csvWhyNot}
              csvTitle="This journal as CSV files in the import format — its days, and its trades if any"
              extra={
                !one && all.length > 1 ? (
                  <button type="button" onClick={() => setImporting(v => !v)} aria-expanded={importing} className={door} title="Bring a CSV from your broker into one of your journals" data-journal-import-door>
                    <FileUp className="w-3 h-3" /> Import
                  </button>
                ) : one ? (
                  <>
                    <button type="button" onClick={() => (importing ? closeImport() : setImporting(true))} aria-expanded={importing} className={door} data-journal-import-door>
                      <FileUp className="w-3 h-3" /> Import
                    </button>
                    <button type="button" onClick={() => setEditing(v => !v)} aria-expanded={editing} className={door} title="Rename or delete this journal" data-journal-edit-door>
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  </>
                ) : null
              }
            />
          </>
        }
        sentence={
          missing ? (
            'This journal is not in this browser — it was deleted, or made in another browser.'
          ) : !all.length ? (
            <>Keep a journal of your real trading here: what each day made, your trades if you like, your notes — typed in or brought in from your broker’s CSV. It sits on the same calendar and charts as your practice, kept apart from it.</>
          ) : !stats.days ? (
            <>Nothing entered {period === 'all' ? 'yet' : `for ${periodLabel.toLowerCase()}`}. Press a day on the calendar to enter it, or bring in a CSV.</>
          ) : (
            <>
              You entered {stats.days} {stats.days === 1 ? 'day' : 'days'}
              {stats.trades ? ` and ${stats.trades} ${stats.trades === 1 ? 'trade' : 'trades'}` : ''}: <span className={`font-semibold ${dirInk(stats.net)}`}>{usdSigned(stats.net)}</span> after {usd(stats.fees)} in fees.
              {stats.bestDay && stats.worstDay && (
                <>
                  {' '}
                  Best day {shortDay(stats.bestDay.day)} (<span className={dirInk(stats.bestDay.net)}>{usdSigned(stats.bestDay.net, 0)}</span>), worst {shortDay(stats.worstDay.day)} (<span className={dirInk(stats.worstDay.net)}>{usdSigned(stats.worstDay.net, 0)}</span>).
                </>
              )}
            </>
          )
        }
      >
        {null}
      </TraceBox>

      {creating && <NewJournal first={!all.length} onMade={id => pickJournal({ book: 'manual', id })} onCancel={all.length ? () => set({ new: null }) : undefined} />}
      {one && editing && <EditJournal j={one} onDone={() => setEditing(false)} onDeleted={() => pickJournal({ book: 'manual', id: null })} />}
      {one && importing && <ImportCard j={one} onClose={closeImport} />}
      {/* the import asked for with more than one journal and none picked: which one it goes into */}
      {!one && !missing && importing && all.length > 1 && (
        <div className={`${card} px-5 py-4 flex flex-col gap-3`} data-manual-import-pick>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={headWord}>Bring in a CSV</span>
            <span className="text-t12 text-textSecondary">Into which journal?</span>
            <button type="button" onClick={closeImport} aria-label="Close the import" className="ml-auto tap-40 inline-flex items-center justify-center w-8 h-8 rounded-md text-textMuted hover:text-textPrimary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {all.map(j => (
              <button key={j.id} type="button" onClick={() => pickJournal({ book: 'manual', id: j.id })} className={door} data-manual-import-into={j.id}>
                {j.name}
                {j.broker ? <span className="normal-case tracking-normal text-textMuted"> · {j.broker}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {missing && (
        <div className={card}>
          <EmptyBox title="No such journal" reason="The link names a journal of your own that this browser does not hold." action={<button type="button" onClick={() => pickJournal({ book: 'manual', id: null })} className={door}>Your journals</button>} />
        </div>
      )}

      {journals.length > 0 && (
        <>
          <div className="grid gap-3 items-stretch min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 min-h-0" data-journal-month-region>
              <JournalCalendar month={month} onMonth={m => set({ month: m === home ? null : m })} home={home} days={days} today={today} picked={picked} onPick={openDay} noted={noted} entered />
            </div>
            <div className="min-w-0 min-h-0" data-journal-stats-region>
              <ManualStatsCard stats={stats} periodLabel={periodLabel} />
            </div>
          </div>

          {picked &&
            (one ? (
              <DayEditor key={`${one.id}:${picked}`} j={one} day={picked} figure={pickedFigure} today={today} onClose={() => openDay(null)} />
            ) : (
              <DayAcross day={picked} journals={journals} onClose={() => openDay(null)} onOpen={id => navigate({ search: searchWithPick(location.search, { book: 'manual', id }, []) })} />
            ))}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-journal-period-drawn>
            <div className={`${card} flex flex-col min-w-0`}>
              <div className={chartHead}>
                <span className={headWord}>The running total</span>
                <span className="font-mono text-t10 text-textMuted">a point a day you entered · a press opens its day</span>
              </div>
              {run.length === 0 ? (
                <EmptyBox title="Nothing entered in this period" className="h-[260px]" />
              ) : (
                <div className="px-5 pb-5" data-journal-running>
                  <SessionsChart
                    points={runPoints}
                    kind="baseline"
                    ink="rgb(var(--bull))"
                    inkBelow="rgb(var(--bear))"
                    height={260}
                    clock="day"
                    range={runRange}
                    zone="ny"
                    scale="pnl"
                    cardW={220}
                    cardH={84}
                    testId="manual-running"
                    onPick={t => {
                      const p = runBy.get(t);
                      if (p) openDay(p.day);
                    }}
                    card={h => {
                      const p = runBy.get(h.time);
                      if (!p) return <div className="font-mono text-t11 text-textSecondary">Before the first day — nothing made, nothing lost</div>;
                      return (
                        <div className="font-mono text-t11 tnum">
                          <div className="text-t10 text-textMuted">{fmtDayLocal(h.time as UTCTimestamp, 'ny')}</div>
                          <div className={`mt-0.5 font-semibold ${dirInk(p.d.net)}`}>{usdSigned(p.d.net)} that day</div>
                          <div className="mt-0.5 text-textSecondary">
                            the total then <span className={dirInk(p.value)}>{usdSigned(p.value)}</span>
                            {p.drop < 0 && <span className="text-textMuted"> · {usd(p.drop)} under its best</span>}
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              )}
            </div>
            <div className={`${card} flex flex-col min-w-0`}>
              <div className={chartHead}>
                <span className={headWord}>What each day made</span>
                <span className="font-mono text-t10 text-textMuted">a bar a day · a press opens the day</span>
              </div>
              {periodDays.length === 0 ? (
                <EmptyBox title="Nothing entered in this period" className="h-[260px]" />
              ) : (
                <div className="px-5 pb-4 pt-2" data-journal-daily>
                  <JournalBars days={periodDays} picked={picked} onPick={openDay} height={260} />
                </div>
              )}
            </div>
          </div>

          {periodTrades.length > 0 && <TradesCard rows={periodTrades} many={journals.length > 1} onOpen={d => openDay(d)} />}
        </>
      )}
      <p className="px-1 font-mono text-t10 text-textMuted">Every number in a journal of your own is what you entered from your own broker — the app has not measured or checked it, and never mixes it with your paper or backtest trades. Every time on this page is New York’s (ET).</p>
    </div>
  );
};

/* ================================================================== */
/* The figures beside the month */
/* ================================================================== */

const Row = ({ label: l, title, children, testId }: { label: string; title?: string; children: ReactNode; testId: string }) => (
  <div className="h-7 flex items-center justify-between gap-4" title={title} data-journal-stat={testId}>
    <span className="font-mono text-t10 uppercase tracking-wider text-textMuted whitespace-nowrap">{l}</span>
    <span className="font-mono text-t12 tnum text-textPrimary whitespace-nowrap">{children}</span>
  </div>
);
const Group = ({ children }: { children: ReactNode }) => <div className="px-5 py-1.5 border-t border-borderSubtle/70 flex-1 flex flex-col justify-center">{children}</div>;
const none = <span className="text-textMuted">—</span>;

const ManualStatsCard = ({ stats: s, periodLabel }: { stats: ReturnType<typeof manualStatsOf>; periodLabel: string }) => (
  <div className={`${card} flex flex-col min-w-0 h-full`} data-journal-stats={s.days}>
    <div className="px-5 pt-3.5 pb-2.5">
      <div className="flex items-center gap-2 justify-between">
        <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">{periodLabel}</span>
        <EnteredChip />
      </div>
      <div className={`mt-1.5 font-mono text-t24 font-semibold tnum leading-none ${s.days ? dirInk(s.net) : 'text-textMuted'}`} data-journal-stats-net>
        {s.days ? usdSigned(s.net) : '$0.00'}
      </div>
      <div className="mt-1.5 font-mono text-t11 tnum text-textSecondary">{s.days ? `${s.days} ${s.days === 1 ? 'day' : 'days'}${s.trades ? ` · ${s.trades} ${s.trades === 1 ? 'trade' : 'trades'}` : ''} · after fees` : 'Nothing entered in this period'}</div>
    </div>
    <Group>
      <Row label="Green · red days" title="Days that made money, and days that lost it" testId="days">
        {s.days ? (
          <>
            <span className="text-bull">{s.greenDays}</span> · <span className="text-bear">{s.redDays}</span> {s.dayWinRate != null && <span className="text-textMuted">· {pct(s.dayWinRate)}</span>}
          </>
        ) : (
          none
        )}
      </Row>
      <Row label="Won · lost trades" title="The wins and losses you entered (or your trades counted)" testId="won">
        {s.winRate != null ? (
          <>
            <span className="text-bull">{s.wins}</span> · <span className="text-bear">{s.losses}</span> <span className="text-textMuted">· {pct(s.winRate)}</span>
          </>
        ) : (
          none
        )}
      </Row>
      <Row label="Profit factor · days" title="What your green days made, over what your red days lost" testId="pf-days">
        {!s.days ? none : s.dayProfitFactor == null ? (s.greenDays ? <span className="text-bull">no red days</span> : none) : <span className={s.dayProfitFactor >= 1 ? 'text-bull' : 'text-bear'}>{s.dayProfitFactor.toFixed(2)}</span>}
      </Row>
      <Row label="Profit factor · trades" title={s.tradesEntered ? `Over the ${s.tradesEntered} trades you entered one by one, after their fees` : 'Enter trades one by one (or import a trades file) for this'} testId="pf-trades">
        {!s.tradesEntered ? none : s.tradeProfitFactor == null ? <span className="text-bull">no losing trades</span> : <span className={s.tradeProfitFactor >= 1 ? 'text-bull' : 'text-bear'}>{s.tradeProfitFactor.toFixed(2)}</span>}
      </Row>
    </Group>
    <Group>
      <Row label="Average green day" testId="avg-green">{s.avgGreenDay != null ? <span className="text-bull">{usdSigned(s.avgGreenDay)}</span> : none}</Row>
      <Row label="Average red day" testId="avg-red">{s.avgRedDay != null ? <span className="text-bear">{usdSigned(s.avgRedDay)}</span> : none}</Row>
      <Row label="Best day" testId="best-day">
        {s.bestDay ? (
          <>
            <span className={dirInk(s.bestDay.net)}>{usdSigned(s.bestDay.net, 0)}</span> <span className="text-textMuted">{shortDay(s.bestDay.day).split(', ')[1]}</span>
          </>
        ) : (
          none
        )}
      </Row>
      <Row label="Worst day" testId="worst-day">
        {s.worstDay ? (
          <>
            <span className={dirInk(s.worstDay.net)}>{usdSigned(s.worstDay.net, 0)}</span> <span className="text-textMuted">{shortDay(s.worstDay.day).split(', ')[1]}</span>
          </>
        ) : (
          none
        )}
      </Row>
    </Group>
    <Group>
      <Row label="P&L before fees" testId="gross">{s.days ? <span className={dirInk(s.gross)}>{usdSigned(s.gross)}</span> : none}</Row>
      <Row label="Fees" testId="fees">{s.days ? <span className="text-textSecondary">{usd(s.fees)}</span> : none}</Row>
      <Row label="Longest run" title="The most green days in a row, and the most red days" testId="runs">
        {s.days ? (
          <>
            <span className="text-bull">{s.greenRun} green</span> · <span className="text-bear">{s.redRun} red</span>
          </>
        ) : (
          none
        )}
      </Row>
      <Row label="Worst drop from a high" title="The most the day-by-day running total fell from its best" testId="drop">
        {!s.days ? none : s.maxDrawdown > 0 ? <span className="text-bear">−{usd(s.maxDrawdown)}</span> : <span className="text-textSecondary">none</span>}
      </Row>
    </Group>
  </div>
);

/* ================================================================== */
/* A day: entered, edited */
/* ================================================================== */

const numText = (v: number | undefined) => (v == null ? '' : String(v));
/** A number field's words, read: blank is nothing, words that are not a number are a miss */
const readNum = (s: string): number | null | 'bad' => {
  const v = numberOf(s);
  return v == null ? null : Number.isNaN(v) ? 'bad' : v;
};

const DayEditor = ({ j, day, figure, today, onClose }: { j: ManualJournal; day: string; figure: ManualDayFigure | null; today: string; onClose: () => void }) => {
  const entry = j.days[day] ?? {};
  const trades = useMemo(() => j.trades.filter(t => t.day === day).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')), [j.trades, day]);
  const fromTrades = useMemo(() => {
    const pnl = trades.reduce((x, t) => x + t.pnl, 0);
    const fees = trades.reduce((x, t) => x + (t.fees ?? 0), 0);
    return { pnl: Math.round(pnl * 100) / 100, fees: Math.round(fees * 100) / 100, n: trades.length, wins: trades.filter(t => t.pnl - (t.fees ?? 0) > 0).length, losses: trades.filter(t => t.pnl - (t.fees ?? 0) < 0).length };
  }, [trades]);
  const [f, setF] = useState({ pnl: numText(entry.pnl), fees: numText(entry.fees), trades: numText(entry.trades), wins: numText(entry.wins), losses: numText(entry.losses), tags: (entry.tags ?? []).join(', '), notes: entry.notes ?? '' });
  const [mark, setMark] = useState<'kept' | 'changed' | null>(null);
  const put = (k: keyof typeof f, v: string) => {
    setF(x => ({ ...x, [k]: v }));
    setMark('changed');
  };
  const nums = { pnl: readNum(f.pnl), fees: readNum(f.fees), trades: readNum(f.trades), wins: readNum(f.wins), losses: readNum(f.losses) };
  const bad = (Object.entries(nums) as [string, number | null | 'bad'][]).filter(([, v]) => v === 'bad').map(([k]) => k);
  const count = (k: 'trades' | 'wins' | 'losses') => (typeof nums[k] === 'number' ? (nums[k] as number) : null);
  const whole = (['trades', 'wins', 'losses'] as const).filter(k => count(k) != null && (count(k)! < 0 || !Number.isInteger(count(k))));
  const over = count('trades') != null && (count('wins') ?? 0) + (count('losses') ?? 0) > count('trades')!;
  const miss = bad.length ? `${bad.join(', ')}: not a number` : whole.length ? `${whole.join(', ')}: a whole number, 0 or more` : over ? 'more wins and losses than trades' : null;
  const save = () => {
    if (miss) return;
    const n = (v: number | null | 'bad') => (typeof v === 'number' ? v : undefined);
    const next: ManualDay = { pnl: n(nums.pnl), fees: n(nums.fees) != null ? Math.abs(n(nums.fees)!) : undefined, trades: n(nums.trades), wins: n(nums.wins), losses: n(nums.losses), notes: f.notes, tags: f.tags.split(/[,;|]/).map(t => t.trim()).filter(Boolean) };
    setManualDay(j.id, day, next);
    setMark('kept');
  };
  const removeDay = () => {
    const before = readManualJournals().find(x => x.id === j.id);
    const at = readManualJournals().findIndex(x => x.id === j.id);
    deleteManualDay(j.id, day);
    if (before) undoable({ label: `Took out ${shortDay(day)}`, undo: () => putManualJournal(before, at), key: `manual-day-${j.id}` });
    onClose();
  };
  const hasAny = !!j.days[day] || trades.length > 0;

  return (
    <div className={`${card} flex flex-col min-w-0 animate-soft-in`} data-manual-day={day}>
      <div className="px-5 pt-4 pb-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
        <span className="text-t15 font-semibold text-textPrimary">{shortDay(day)}</span>
        <span className={`font-mono text-t22 font-semibold tnum leading-none ${figure ? dirInk(figure.net) : 'text-textMuted'}`} data-journal-day-net>
          {figure ? usdSigned(figure.net) : '—'}
        </span>
        <span className="font-mono text-t11 tnum text-textSecondary">{figure ? `${countWords(figure, 'traded')} · ${usd(figure.fees)} fees · from your ${figure.from === 'day' ? 'day’s numbers' : 'trades'}` : day > today ? 'Still to come — a plan can be written now' : 'Nothing entered for this day'}</span>
        <EnteredChip />
        <button type="button" onClick={onClose} title="Close the day" aria-label="Close the day" className="ml-auto -mr-1.5 tap-40 inline-flex items-center justify-center w-8 h-8 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-journal-day-close>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="border-t border-borderSubtle/70 grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* THE DAY'S NUMBERS — a blank one is added up from the day's trades */}
        <form
          className="px-5 pt-4 pb-5 flex flex-col gap-3 min-w-0 xl:border-r xl:border-borderSubtle/70"
          onSubmit={e => {
            e.preventDefault();
            save();
          }}
          data-manual-day-form
        >
          <span className={headWord}>The day, from your broker</span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <NumField label="P&L before fees" value={f.pnl} onChange={v => put('pnl', v)} hint={trades.length ? usdSigned(fromTrades.pnl) : '+1250.50'} testId="pnl" wide />
            <NumField label="Fees" value={f.fees} onChange={v => put('fees', v)} hint={trades.length ? fromTrades.fees.toFixed(2) : '0.00'} testId="fees" />
            <NumField label="Trades" value={f.trades} onChange={v => put('trades', v)} hint={trades.length ? String(fromTrades.n) : '0'} testId="trades" />
            <NumField label="Wins" value={f.wins} onChange={v => put('wins', v)} hint={trades.length ? String(fromTrades.wins) : '0'} testId="wins" />
            <NumField label="Losses" value={f.losses} onChange={v => put('losses', v)} hint={trades.length ? String(fromTrades.losses) : '0'} testId="losses" />
          </div>
          {trades.length > 0 && <p className="font-mono text-t10 text-textMuted">A box left blank takes the figure your trades below add up to (shown faint in it).</p>}
          <label className="flex flex-col gap-1">
            <span className={label}>Tags · separated by commas</span>
            <input className={field} value={f.tags} onChange={e => put('tags', e.target.value)} placeholder="Opening range, Patience" data-manual-field="tags" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Notes · the plan, how it went</span>
            <textarea className={`${field} h-auto min-h-[84px] py-2 font-sans leading-relaxed resize-y`} value={f.notes} onChange={e => put('notes', e.target.value)} placeholder="What you were looking for, and how the day went against it" data-manual-field="notes" />
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <button type="submit" disabled={!!miss} className="tap-40 inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-silver/50 text-t12 font-semibold text-textPrimary hover:bg-ink/[0.05] disabled:opacity-50 disabled:cursor-not-allowed" data-manual-save>
              <Check className="w-3.5 h-3.5" /> Keep the day
            </button>
            {miss && <span className="text-t11 text-warn" role="alert">{miss}</span>}
            {!miss && mark === 'kept' && <span className="font-mono text-t9 uppercase tracking-widest text-silver" aria-live="polite" data-manual-kept>Kept</span>}
            {!miss && mark === 'changed' && <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">Not kept yet</span>}
            {hasAny && (
              <button type="button" onClick={removeDay} className="ml-auto tap-40 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-t11 text-textMuted hover:text-bear transition-colors" data-manual-day-delete>
                <Trash2 className="w-3.5 h-3.5" /> Take the day out
              </button>
            )}
          </div>
        </form>
        {/* THE DAY'S TRADES, if the reader keeps them */}
        <div className="px-5 pt-4 pb-5 flex flex-col gap-3 min-w-0 max-xl:border-t max-xl:border-borderSubtle/70" data-manual-trades={trades.length}>
          <span className={headWord}>Trades on the day · optional</span>
          {trades.length > 0 ? (
            <ul className="flex flex-col divide-y divide-borderSubtle/60">
              {trades.map(t => (
                <li key={t.id} className="py-1.5 flex items-center gap-3 font-mono text-t11 tnum min-w-0" data-manual-trade={t.id}>
                  <span className="text-textMuted w-[54px] shrink-0">{t.time ? `${t.time} ET` : '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-textPrimary">
                    <span className="font-semibold">{t.contract || t.ticker}</span> <span className={t.side === 'long' ? 'text-bull' : 'text-bear'}>{t.side}</span>
                    {t.qty != null && <span className="text-textSecondary"> · {t.qty}</span>}
                    {t.entry != null && t.exit != null && (
                      <span className="text-textSecondary">
                        {' '}
                        · {t.entry} → {t.exit}
                      </span>
                    )}
                  </span>
                  <span className={`font-semibold ${dirInk(t.pnl - (t.fees ?? 0))}`} title={t.fees ? `${usdSigned(t.pnl)} before ${usd(t.fees)} in fees` : undefined}>
                    {usdSigned(t.pnl - (t.fees ?? 0))}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const before = readManualJournals().find(x => x.id === j.id);
                      const at = readManualJournals().findIndex(x => x.id === j.id);
                      deleteManualTrade(j.id, t.id);
                      if (before) undoable({ label: `Took out a ${t.ticker} trade`, undo: () => putManualJournal(before, at), key: `manual-trade-${j.id}` });
                    }}
                    className="tap-40 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-textMuted hover:text-bear"
                    title="Take this trade out"
                    aria-label={`Take out the ${t.ticker} trade`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-t12 text-textSecondary">The day’s numbers are enough. Add trades one by one if you want the trade figures (the trades’ profit factor) as well.</p>
          )}
          <TradeForm onAdd={t => addManualTrade(j.id, { ...t, day })} />
        </div>
      </div>
    </div>
  );
};

const NumField = ({ label: l, value, onChange, hint, testId, wide = false }: { label: string; value: string; onChange: (v: string) => void; hint: string; testId: string; wide?: boolean }) => (
  <label className={`flex flex-col gap-1 min-w-0 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
    <span className={`${label} truncate`}>{l}</span>
    <input className={field} inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder={hint} data-manual-field={testId} />
  </label>
);

const TRADE_AT_REST = { time: '', ticker: '', contract: '', side: 'long' as ManualSide, qty: '', entry: '', exit: '', pnl: '', fees: '' };
const TradeForm = ({ onAdd }: { onAdd: (t: Omit<ManualTrade, 'id' | 'day'>) => void }) => {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(TRADE_AT_REST);
  const put = (k: keyof typeof t, v: string) => setT(x => ({ ...x, [k]: v }));
  const qty = readNum(t.qty);
  const entry = readNum(t.entry);
  const exit = readNum(t.exit);
  const pnl = readNum(t.pnl);
  const fees = readNum(t.fees);
  const worked = pnl == null && typeof qty === 'number' && typeof entry === 'number' && typeof exit === 'number' ? tradePnlOf(t.side, qty, entry, exit, t.contract) : null;
  const time = t.time.trim();
  const miss = !t.ticker.trim() ? 'a ticker' : [qty, entry, exit, pnl, fees].includes('bad') ? 'numbers only in the number boxes' : time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time) ? 'a time as HH:MM' : pnl == null && worked == null ? 'a P&L, or the size, entry and exit' : null;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${door} self-start`} data-manual-trade-open>
        <Plus className="w-3 h-3" /> Add a trade
      </button>
    );
  const add = () => {
    if (miss) return;
    const num = (v: number | null | 'bad') => (typeof v === 'number' ? v : undefined);
    onAdd({ time: time ? time.padStart(5, '0') : undefined, ticker: t.ticker.trim().toUpperCase(), contract: t.contract.trim() || undefined, side: t.side, qty: num(qty) != null ? Math.abs(num(qty)!) : undefined, entry: num(entry), exit: num(exit), pnl: typeof pnl === 'number' ? Math.round(pnl * 100) / 100 : worked!, fees: num(fees) != null ? Math.abs(num(fees)!) : undefined });
    setT(TRADE_AT_REST);
  };
  return (
    <form
      className="flex flex-col gap-2.5 rounded-md border border-borderSubtle p-3"
      onSubmit={e => {
        e.preventDefault();
        add();
      }}
      data-manual-trade-form
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Time · ET</span>
          <input className={field} value={t.time} onChange={e => put('time', e.target.value)} placeholder="09:45" data-manual-trade-field="time" />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Ticker</span>
          <input className={field} value={t.ticker} onChange={e => put('ticker', e.target.value)} placeholder="SPY" data-manual-trade-field="ticker" />
        </label>
        <label className="flex flex-col gap-1 min-w-0 col-span-2">
          <span className={label}>Contract · blank for shares</span>
          <input className={field} value={t.contract} onChange={e => put('contract', e.target.value)} placeholder="SPY 580C Oct 30" data-manual-trade-field="contract" />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Side</span>
          <select className={field} value={t.side} onChange={e => put('side', e.target.value)} data-manual-trade-field="side">
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Qty</span>
          <input className={field} inputMode="decimal" value={t.qty} onChange={e => put('qty', e.target.value)} placeholder="2" data-manual-trade-field="qty" />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Entry</span>
          <input className={field} inputMode="decimal" value={t.entry} onChange={e => put('entry', e.target.value)} placeholder="1.85" data-manual-trade-field="entry" />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Exit</span>
          <input className={field} inputMode="decimal" value={t.exit} onChange={e => put('exit', e.target.value)} placeholder="2.40" data-manual-trade-field="exit" />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>P&amp;L before fees</span>
          <input className={field} inputMode="decimal" value={t.pnl} onChange={e => put('pnl', e.target.value)} placeholder={worked != null ? usdSigned(worked) : '+110.00'} data-manual-trade-field="pnl" />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Fees</span>
          <input className={field} inputMode="decimal" value={t.fees} onChange={e => put('fees', e.target.value)} placeholder="2.60" data-manual-trade-field="fees" />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="submit" disabled={!!miss} className="tap-40 inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-silver/50 text-t12 font-semibold text-textPrimary hover:bg-ink/[0.05] disabled:opacity-50 disabled:cursor-not-allowed" data-manual-trade-add>
          <Plus className="w-3.5 h-3.5" /> Add it
        </button>
        <span className="text-t11 text-textMuted">{miss ? `Needs ${miss}` : worked != null ? `P&L worked out: ${usdSigned(worked)} (${t.contract.trim() ? '× 100 a contract' : '× 1 a share'})` : ''}</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-t11 text-textMuted hover:text-textPrimary">
          Done
        </button>
      </div>
    </form>
  );
};

/** A day across every journal of your own: each one's numbers, read-only — edit it in its own journal */
const DayAcross = ({ day, journals, onClose, onOpen }: { day: string; journals: ManualJournal[]; onClose: () => void; onOpen: (id: string) => void }) => {
  const each = journals.map(j => ({ j, f: manualDaysOf([j]).get(day) ?? null }));
  return (
    <div className={`${card} flex flex-col min-w-0 animate-soft-in`} data-manual-day-across={day}>
      <div className="px-5 pt-4 pb-3 flex items-center gap-4 flex-wrap">
        <span className="text-t15 font-semibold text-textPrimary">{shortDay(day)}</span>
        <EnteredChip />
        <button type="button" onClick={onClose} aria-label="Close the day" className="ml-auto tap-40 inline-flex items-center justify-center w-8 h-8 rounded-md text-textMuted hover:text-textPrimary">
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="border-t border-borderSubtle/70 divide-y divide-borderSubtle/60">
        {each.map(({ j, f }) => (
          <li key={j.id} className="px-5 py-2.5 flex items-center gap-4 flex-wrap font-mono text-t11 tnum">
            <span className="text-textPrimary font-semibold">{j.name}</span>
            <span className={f ? dirInk(f.net) : 'text-textMuted'}>{f ? usdSigned(f.net) : 'nothing entered'}</span>
            {f && <span className="text-textSecondary">{countWords(f, 'traded')}</span>}
            <button type="button" onClick={() => onOpen(j.id)} className={`${door} ml-auto`}>
              {f ? 'Edit in it' : 'Enter it there'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ================================================================== */
/* The trades entered, over the period */
/* ================================================================== */

type TradeRow = { t: ManualTrade; j: ManualJournal };
const TradesCard = ({ rows, many, onOpen }: { rows: TradeRow[]; many: boolean; onOpen: (day: string) => void }) => {
  const columns = useMemo<Column<TradeRow>[]>(
    () => [
      { key: 'when', header: 'When (ET)', sortValue: r => `${r.t.day} ${r.t.time ?? ''}`, render: r => <span className="text-textSecondary">{shortDay(r.t.day)}{r.t.time ? ` · ${r.t.time}` : ''}</span> },
      ...(many ? [{ key: 'journal', header: 'Journal', sortValue: (r: TradeRow) => r.j.name, render: (r: TradeRow) => <span className="text-textSecondary truncate">{r.j.name}</span> }] : []),
      { key: 'what', header: 'Traded', sortValue: r => r.t.contract || r.t.ticker, render: r => <span className="text-textPrimary font-semibold truncate">{r.t.contract || r.t.ticker}</span> },
      { key: 'side', header: 'Side', sortValue: r => r.t.side, render: r => <span className={r.t.side === 'long' ? 'text-bull' : 'text-bear'}>{r.t.side}</span> },
      { key: 'qty', header: 'Size', align: 'right', sortValue: r => r.t.qty ?? 0, render: r => <span className="text-textPrimary">{r.t.qty ?? '—'}</span> },
      { key: 'inout', header: 'In → out', align: 'right', render: r => <span className="text-textSecondary">{r.t.entry != null && r.t.exit != null ? `${r.t.entry} → ${r.t.exit}` : '—'}</span> },
      { key: 'fees', header: 'Fees', align: 'right', sortValue: r => r.t.fees ?? 0, render: r => <span className="text-textSecondary">{r.t.fees != null ? usd(r.t.fees) : '—'}</span> },
      { key: 'net', header: 'Made or lost', align: 'right', sortValue: r => r.t.pnl - (r.t.fees ?? 0), render: r => <span className={`font-semibold ${dirInk(r.t.pnl - (r.t.fees ?? 0))}`}>{usdSigned(r.t.pnl - (r.t.fees ?? 0))}</span> },
    ],
    [many]
  );
  return (
    <div className={`${card} flex flex-col min-w-0`} data-journal-trades>
      <div className={chartHead}>
        <span className={headWord}>The trades you entered</span>
        <span className="font-mono text-t10 tnum text-textMuted">{rows.length}</span>
        <EnteredChip className="ml-auto" />
      </div>
      <TraceGrid rows={rows} columns={columns} rowKey={r => r.t.id} onRowClick={r => onOpen(r.t.day)} autoHeight animate={false} widths={{ when: 150, qty: 64, side: 72, fees: 90 }} emptyText="No trades entered in this period" testId="manual-trades" />
    </div>
  );
};

/* ================================================================== */
/* A journal: made, renamed, deleted, filled from a file */
/* ================================================================== */

const NewJournal = ({ first, onMade, onCancel }: { first: boolean; onMade: (id: string) => void; onCancel?: () => void }) => {
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  return (
    <form
      className={`${card} px-5 py-4 flex flex-col gap-3`}
      onSubmit={e => {
        e.preventDefault();
        onMade(createManualJournal(name || 'My trading', broker));
      }}
      data-manual-new
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className={headWord}>{first ? 'Start a journal of your own' : 'A new journal of your own'}</span>
        <EnteredChip />
      </div>
      <p className="text-t12 text-textSecondary max-w-[720px]">One journal for each real account you trade. You enter each day’s P&amp;L, fees, trades, wins and losses (or bring them in from a CSV), and the journal adds them up on the calendar and charts. Kept in this browser only.</p>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2.5 items-end">
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Name</span>
          <input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="My trading" maxLength={60} autoFocus={!first} data-manual-new-name />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Broker or account · optional</span>
          <input className={field} value={broker} onChange={e => setBroker(e.target.value)} placeholder="Schwab · IRA" maxLength={60} data-manual-new-broker />
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" className="tap-40 inline-flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-md border border-silver/50 text-t12 font-semibold text-textPrimary hover:bg-ink/[0.05]" data-manual-new-make>
            <Plus className="w-3.5 h-3.5" /> Make it
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="h-10 sm:h-8 px-2 text-t12 text-textMuted hover:text-textPrimary">
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
};

const EditJournal = ({ j, onDone, onDeleted }: { j: ManualJournal; onDone: () => void; onDeleted: () => void }) => {
  const [name, setName] = useState(j.name);
  const [broker, setBroker] = useState(j.broker ?? '');
  return (
    <form
      className={`${card} px-5 py-4 flex flex-col gap-3`}
      onSubmit={e => {
        e.preventDefault();
        renameManualJournal(j.id, name, broker);
        onDone();
      }}
      data-manual-edit
    >
      <span className={headWord}>This journal</span>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2.5 items-end">
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Name</span>
          <input className={field} value={name} onChange={e => setName(e.target.value)} maxLength={60} />
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className={label}>Broker or account · optional</span>
          <input className={field} value={broker} onChange={e => setBroker(e.target.value)} maxLength={60} />
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="submit" className="tap-40 inline-flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-md border border-silver/50 text-t12 font-semibold text-textPrimary hover:bg-ink/[0.05]">
            <Check className="w-3.5 h-3.5" /> Keep
          </button>
          <button
            type="button"
            onClick={() => {
              const at = readManualJournals().findIndex(x => x.id === j.id);
              const before = readManualJournals()[at];
              deleteManualJournal(j.id);
              if (before) undoable({ label: `Deleted ${before.name}`, undo: () => putManualJournal(before, at), ms: 10000, key: `manual-journal-${j.id}` });
              onDeleted();
            }}
            className="tap-40 inline-flex items-center gap-1.5 h-10 sm:h-8 px-2.5 rounded-md text-t12 text-textMuted hover:text-bear"
            data-manual-delete
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete the journal
          </button>
        </div>
      </div>
    </form>
  );
};

const ImportCard = ({ j, onClose }: { j: ManualJournal; onClose: () => void }) => {
  const [text, setText] = useState('');
  const [read, setRead] = useState<CsvRead | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setRead(text.trim() ? readJournalCsv(text) : null);
    /* the "brought in" line stays until something new is pasted */
    if (text.trim()) setDone(null);
  }, [text]);
  const count = read ? (read.kind === 'trades' ? read.trades.length : read.days.length) : 0;
  const bring = () => {
    if (!read || !count) return;
    const before = readManualJournals().find(x => x.id === j.id);
    const at = readManualJournals().findIndex(x => x.id === j.id);
    const res = importManual(j.id, read);
    if (!res) return;
    const words = read.kind === 'trades' ? `${res.tradesAdded} ${res.tradesAdded === 1 ? 'trade' : 'trades'} added${res.tradesSkipped ? `, ${res.tradesSkipped} already in it` : ''}` : `${res.daysNew} new ${res.daysNew === 1 ? 'day' : 'days'}${res.daysReplaced ? `, ${res.daysReplaced} replaced` : ''}`;
    setDone(words);
    setText('');
    if (before) undoable({ label: `Imported into ${j.name}: ${words}`, undo: () => putManualJournal(before, at), ms: 10000, key: `manual-import-${j.id}` });
  };
  return (
    <div className={`${card} flex flex-col min-w-0`} data-manual-import>
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-wrap">
        <span className={headWord}>Bring in a CSV</span>
        <EnteredChip />
        <button type="button" onClick={onClose} aria-label="Close the import" className="ml-auto tap-40 inline-flex items-center justify-center w-8 h-8 rounded-md text-textMuted hover:text-textPrimary">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="border-t border-borderSubtle/70 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="px-5 py-4 flex flex-col gap-3 min-w-0 lg:border-r lg:border-borderSubtle/70">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => fileRef.current?.click()} className={door} data-manual-import-file>
              <FileUp className="w-3 h-3" /> Choose a file
            </button>
            <span className="text-t11 text-textMuted">or paste it below</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) f.text().then(setText);
                e.target.value = '';
              }}
            />
          </div>
          <textarea className={`${field} h-auto min-h-[132px] py-2 text-t11 leading-relaxed resize-y`} value={text} onChange={e => setText(e.target.value)} placeholder={CSV_DAYS_EXAMPLE} spellCheck={false} data-manual-import-text />
          {read && (
            <div className="flex flex-col gap-1.5" data-manual-import-read={read.kind ?? 'none'} data-count={count} data-misses={read.misses.length}>
              <p className="text-t12 text-textPrimary">
                {read.kind ? (
                  <>
                    A {read.kind} file: <span className="font-semibold">{count}</span> {read.kind === 'trades' ? (count === 1 ? 'trade' : 'trades') : count === 1 ? 'day' : 'days'} to bring in
                    {read.kind === 'days' && count > 0 && ` · ${usdSigned(read.days.reduce((x, d) => x + (d.entry.pnl ?? 0) - (d.entry.fees ?? 0), 0))} after fees`}
                    {read.kind === 'days' && read.days.some(d => j.days[d.day]) && <span className="text-warn"> · {read.days.filter(d => j.days[d.day]).length} replace days already entered</span>}
                  </>
                ) : (
                  'Nothing in it can be read yet'
                )}
              </p>
              {read.misses.length > 0 && (
                <ul className="text-t11 text-warn flex flex-col gap-0.5" role="alert">
                  {read.misses.slice(0, 6).map(m => (
                    <li key={`${m.line}:${m.why}`}>
                      Line {m.line}: {m.why}
                    </li>
                  ))}
                  {read.misses.length > 6 && <li>…and {read.misses.length - 6} more lines left out</li>}
                </ul>
              )}
              <div className="flex items-center gap-3">
                <button type="button" onClick={bring} disabled={!count} className="tap-40 inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-silver/50 text-t12 font-semibold text-textPrimary hover:bg-ink/[0.05] disabled:opacity-50 disabled:cursor-not-allowed" data-manual-import-go>
                  <Check className="w-3.5 h-3.5" /> Bring {count || 'them'} into {j.name}
                </button>
              </div>
            </div>
          )}
          {done && (
            <p className="text-t12 text-silver" aria-live="polite" data-manual-import-done>
              Brought in: {done}.
            </p>
          )}
        </div>
        <div className="px-5 py-4 flex flex-col gap-2.5 min-w-0 text-t12 text-textSecondary max-lg:border-t max-lg:border-borderSubtle/70" data-manual-format>
          <span className={headWord}>The format</span>
          <p>A header row, then a line a day — or a line a trade. Columns in any order, names in any case.</p>
          <p>
            <span className="text-textPrimary font-semibold">A days file</span> has <code className="font-mono text-t11">date</code> and <code className="font-mono text-t11">pnl</code> (the day’s P&amp;L before fees), and may have <code className="font-mono text-t11">fees</code>, <code className="font-mono text-t11">trades</code>, <code className="font-mono text-t11">wins</code>, <code className="font-mono text-t11">losses</code>, <code className="font-mono text-t11">notes</code> and <code className="font-mono text-t11">tags</code> (split by ; or |). A day already entered is replaced.
          </p>
          <pre className="font-mono text-t10 leading-relaxed text-textPrimary bg-chip rounded-md px-3 py-2 overflow-x-auto">{CSV_DAYS_EXAMPLE}</pre>
          <p>
            <span className="text-textPrimary font-semibold">A trades file</span> has <code className="font-mono text-t11">date</code>, <code className="font-mono text-t11">ticker</code> and <code className="font-mono text-t11">pnl</code> — or <code className="font-mono text-t11">qty</code>, <code className="font-mono text-t11">entry</code> and <code className="font-mono text-t11">exit</code>, and the P&amp;L is worked out (× 100 when a contract is named, × 1 for shares, or the file’s <code className="font-mono text-t11">multiplier</code>). Also <code className="font-mono text-t11">time</code> (HH:MM ET), <code className="font-mono text-t11">contract</code>, <code className="font-mono text-t11">side</code> (long, short, buy, sell), <code className="font-mono text-t11">fees</code>, <code className="font-mono text-t11">notes</code>. A trade already in the journal is not added twice.
          </p>
          <pre className="font-mono text-t10 leading-relaxed text-textPrimary bg-chip rounded-md px-3 py-2 overflow-x-auto">{CSV_TRADES_EXAMPLE}</pre>
          <p className="text-t11 text-textMuted">Dates as 2026-10-28 or 10/28/2026. Money as 1250.50, $1,250.50, -340 or (340.00). The export writes this same format.</p>
        </div>
      </div>
    </div>
  );
};
