/* The journal's front page: the month first, the period's figures beside it, what each day made, the lanes, and a
   day opened under the month — for ONE journal: every paper account, one of them, every backtest session, or one
   (`?journal=…`, data/review/journalBooks.ts). A journal of the reader's own entries is JournalManual.tsx. */

import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import TraceBox, { Fact, RestFoot, TraceGrid, useRestCap } from '../../components/trace/TraceBox';
import SessionsChart, { type ChartPoint } from '../../components/record/SessionsChart';
import ContractLabel from '../../components/ui/ContractLabel';
import type { Column } from '../../components/ui/DataTable';
import JournalCalendar from './JournalCalendar';
import JournalBars from './JournalBars';
import { EndDoors, JournalPicker, PeriodPick, door, saveFile } from './JournalPicker';
import { FileUp } from 'lucide-react';
import { EmptyBox } from '../../components/ui/states';
import JournalStats from '../../components/review/JournalStats';
import JournalDay, { type DayHolder } from '../../components/review/JournalDay';
import JournalLanes from '../../components/review/JournalLanes';
import { card, headWord } from '../../components/review/DeskShell';
import { fmtStampLocal } from '../../components/gex/chartTime';
import { dirInk, heldWords, pct, rWords, usd, usdSigned } from '../../components/review/words';
import { statsOf } from '../../data/review/engine';
import { excursionOf } from '../../data/review/excursion';
import { ENDED, csvOf, dayMinOf, instantOf, priceWordsOf, titleOf, whenWords, type DayNote, type JournalRow } from '../../data/review/journal';
import { PERIODS, byAccount, byHour, byName, bySetup, bySide, bySize, byWeekday, calendarDayOf, dayTotals, isPeriod, monthOf, monthWords, runningOf, rowsIn, spanOf, type Period } from '../../data/review/journalFigures';
import { useJournalSource, type JournalKind } from '../../data/review/journalSource';
import { pickOf, searchWithPick, useSeen, type JournalPick } from '../../data/review/journalBooks';
import { asOfText } from '../../components/ui/states';
import { contractWords } from '../../data/review/quotes';
import { MONTHS } from '../../core/calendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
/** A chart's card: the head word, a line under it, the chart */
const chartHead = 'px-5 pt-4 pb-3 flex items-baseline gap-3 flex-wrap';

/** The soft swap's fade-out; the fade-in is index.css's view-in (320ms) */
const SWAP_OUT_MS = 160;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A region of the page that soft-swaps: `out` fades it while the old is still drawn; remounted by its key, a region
    that arrives after the page did fades in (view-in) — the first paint never does, so the page opens at once */
const Swap = ({ out, late, className = '', style, children, ...rest }: { out: boolean; late: boolean; children: ReactNode } & HTMLAttributes<HTMLDivElement>) => {
  const [arrives] = useState(late);
  return (
    <div {...rest} className={`${className} ${arrives ? 'animate-view-in' : ''}`} style={{ ...style, opacity: out ? 0 : 1, transition: `opacity ${SWAP_OUT_MS}ms ease-in` }} data-swap-out={out || undefined}>
      {children}
    </div>
  );
};

const FutLabel = ({ r }: { r: Extract<JournalRow, { fut: true }> }) => (
  <span className="inline-flex items-center gap-1.5 font-mono text-t11">
    <span className="font-semibold text-textPrimary">{r.t.contract}</span>
    <span className={`font-semibold ${r.t.long ? 'text-bull' : 'text-bear'}`}>{r.t.long ? 'long' : 'short'}</span>
  </span>
);
const Contract = ({ r }: { r: JournalRow }) => (r.fut ? <FutLabel r={r} /> : <ContractLabel contract={contractWords(r.t.contract)} right={r.t.contract.right} logo={r.t.contract.ticker} size="sm" />);

/** What the page is drawn from — the book and the address's picks, as one snapshot (the soft swap) */
interface Drawn {
  key: string;
  kind: JournalKind;
  period: Period;
  session: string | null;
  picked: string | null;
}

export const JournalHome = ({ kind: liveKind }: { kind: JournalKind }) => {
  const location = useLocation();
  const navigate = useNavigate();

  /* ---- what the address says, live: the controls show it at once ---- */
  const q = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const livePeriod: Period = isPeriod(q.get('period')) ? (q.get('period') as Period) : 'month';
  const livePick = pickOf(location.search);
  const liveSession = livePick.id;
  const livePicked = ISO_DAY.test(q.get('day') ?? '') ? q.get('day') : null;

  /* The soft swap (the head comment): the page is drawn from ONE SNAPSHOT that trails the address by the fade */
  const liveKey = `${liveKind}|${livePeriod}|${liveSession ?? ''}|${livePicked ?? ''}`;
  const [drawn, setDrawn] = useState<Drawn>({ key: liveKey, kind: liveKind, period: livePeriod, session: liveSession, picked: livePicked });
  const [fading, setFading] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
  }, []);
  useEffect(() => {
    if (liveKey === drawn.key) return;
    const next: Drawn = { key: liveKey, kind: liveKind, period: livePeriod, session: liveSession, picked: livePicked };
    if (reducedMotion()) {
      setDrawn(next);
      return;
    }
    setFading(true);
    const t = window.setTimeout(() => {
      setDrawn(next);
      setFading(false);
    }, SWAP_OUT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);
  const { kind, period, picked } = drawn;
  const source = useJournalSource(kind);
  const today = source.today;
  const account = source.containers.some(c => c.id === drawn.session) ? drawn.session : null;
  /* a journal the address names that is not here: deleted on its own page since (the register remembers it), or never
     in this browser */
  const seen = useSeen();
  const missing = drawn.session && !account ? { id: drawn.session, was: kind === 'paper' || kind === 'backtest' ? (seen[kind][drawn.session] ?? null) : null } : null;
  const liveAccount = source.containers.some(c => c.id === liveSession) ? liveSession : null;
  /* the regions, keyed by what they are drawn from — a region fades only when its own key is about to change */
  const monthKey = `${kind}|${account ?? ''}`;
  const monthOut = fading && monthKey !== `${liveKind}|${liveAccount ?? ''}`;
  const periodKey = `${kind}|${period}|${account ?? ''}`;
  const periodOut = fading && periodKey !== `${liveKind}|${livePeriod}|${liveAccount ?? ''}`;
  const dayKey = `${periodKey}|${picked ?? ''}`;
  const dayOut = fading && dayKey !== `${liveKind}|${livePeriod}|${liveAccount ?? ''}|${livePicked ?? ''}`;

  const home = monthOf(today);
  /* the calendar's page and its ring are the reader's hand — live, like the controls */
  const month = ISO_MONTH.test(q.get('month') ?? '') ? q.get('month')! : livePicked ? monthOf(livePicked) : home;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    navigate({ search: s ? `?${s}` : '' }, { replace: true });
  };
  const pickJournal = (p: JournalPick) => navigate({ search: searchWithPick(location.search, p, ['day', 'month']) }, { replace: true });
  const openNew = () => {
    const next = new URLSearchParams(searchWithPick(location.search, { book: 'manual', id: null }, ['day', 'month']));
    next.set('new', '1');
    navigate({ search: `?${next}` });
  };
  const openDay = (day: string | null) => set({ day, month: day && monthOf(day) !== home ? monthOf(day) : day ? null : q.get('month') });
  const openTrade = (r: JournalRow) => navigate(`${source.base}/${r.s.id}/${r.t.id}${location.search}`);

  /* ---- the trades: the account's (the calendar), and the period's (everything else) ---- */
  /* a journal that is gone has no trades to show — never the rest of the book's in its place */
  const accountRows = useMemo(() => (missing ? [] : account ? source.rows.filter(r => r.s.id === account) : source.rows), [source.rows, account, !!missing]); // eslint-disable-line react-hooks/exhaustive-deps
  const span = spanOf(period, today);
  const rows = useMemo(() => rowsIn(accountRows, span), [accountRows, period, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => dayTotals(accountRows), [accountRows]);
  const periodDays = useMemo(() => dayTotals(rows), [rows]);
  const stats = useMemo(() => statsOf(rows.map(r => r.t)), [rows]);
  const accountsIn = new Set(rows.map(r => r.s.id)).size;
  const nameOfAccount = (id: string) => source.containers.find(c => c.id === id)?.name ?? id;

  /* the days that have words: on the account, or on any */
  const noted = useMemo(() => {
    const out = new Set<string>();
    for (const c of account ? [{ id: account }] : source.containers) for (const [d, n] of Object.entries(source.notesOf(c.id))) if ((n.plan ?? '').trim() || (n.review ?? '').trim()) out.add(d);
    return out;
  }, [source, account]);

  /* The period, drawn */
  const run = useMemo(() => runningOf(rows), [rows]);
  const runBy = useMemo(() => new Map(run.map(p => [p.time, p])), [run]);
  /* ONE list each, kept — a fresh array drops the card under the pointer (SessionsChart's own note) */
  const runPoints = useMemo<ChartPoint[]>(() => run.map(p => ({ time: p.time, value: p.value })), [run]);
  const runRange = useMemo(() => [Math.min(0, ...run.map(p => p.value)), Math.max(0, ...run.map(p => p.value))] as const, [run]);
  const daily = useMemo(() => [...periodDays.values()].sort((a, b) => (a.day < b.day ? -1 : 1)), [periodDays]);
  const oneDay = periodDays.size <= 1;

  /* ---- five cuts ---- */
  const hours = useMemo(() => byHour(rows), [rows]);
  const weekdays = useMemo(() => byWeekday(rows), [rows]);
  const names = useMemo(() => byName(rows).slice(0, 8), [rows]);
  const sides = useMemo(() => bySide(rows), [rows]);
  const sizes = useMemo(() => bySize(rows), [rows]);
  const setups = useMemo(() => bySetup(rows).slice(0, 8), [rows]);
  const perAccount = useMemo(() => (account || source.containers.length < 2 ? null : byAccount(rows).slice(0, 8)), [rows, account, source.containers.length]);

  /* ---- the words of the head ---- */
  const periodLabel = PERIODS.find(p => p.value === period)!.label;
  const title = period === 'today' ? 'Today' : period === 'week' ? 'This week' : period === 'month' ? monthWords(home) : period === 'year' ? today.slice(0, 4) : 'All time';
  const spanWords = !span ? 'Every trade kept in this browser' : period === 'today' ? `${shortDay(today)} · New York’s day` : period === 'week' ? `${shortDay(span.from)} to ${shortDay(span.to <= today ? span.to : today)}` : period === 'month' ? `${MONTHS[Number(home.slice(5)) - 1]} 1 to ${shortDay(today).split(', ')[1]}` : `Jan 1 to ${shortDay(today).split(', ')[1]}, ${today.slice(0, 4)}`;
  const whose = account ? `on ${nameOfAccount(account)}` : source.containers.length > 1 ? `on all ${source.containers.length} ${source.containerWord}s` : '';
  /* the backtest's book counts by its own clock: its "today" is the last day replayed */
  const clockWords = kind === 'backtest' ? ' · by the backtest’s clock' : '';
  const lead = period === 'today' ? 'Today' : period === 'week' ? 'This week' : period === 'month' ? `In ${monthWords(home).split(' ')[0]}` : period === 'year' ? `In ${today.slice(0, 4)}` : 'In all';
  const ranked = [...periodDays.values()].sort((a, b) => b.net - a.net);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  /* ---- the day, when one is open ---- */
  const pickedTotal = picked ? (days.get(picked) ?? null) : null;
  const holders = useMemo<DayHolder[]>(() => {
    if (!picked) return [];
    const ids = [...new Set((pickedTotal?.rows ?? []).map(r => r.s.id))];
    if (!ids.length) {
      const one = account ?? source.current ?? source.containers[0]?.id;
      if (one) ids.push(one);
    }
    return ids.map(id => ({ id, name: nameOfAccount(id), note: (source.notesOf(id)[picked] ?? {}) as DayNote }));
  }, [picked, pickedTotal, account, source]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- every trade in the period ---- */
  const newestFirst = useMemo(() => [...rows].sort((a, b) => instantOf(b, b.t.closed) - instantOf(a, a.t.closed)), [rows]);
  const cap = useRestCap(newestFirst);
  const columns = useMemo<Column<JournalRow>[]>(
    () => [
      { key: 'closed', header: 'Closed', sortValue: r => instantOf(r, r.t.closed), render: r => <span className="text-textSecondary">{whenWords(r, r.t.closed)}</span> },
      { key: 'account', header: source.containerWord === 'account' ? 'Account' : 'Session', sortValue: r => r.s.name, render: r => <span className="text-textSecondary truncate">{r.s.name}</span> },
      { key: 'contract', header: 'Contract', sortValue: r => titleOf(r), render: r => <Contract r={r} /> },
      { key: 'qty', header: 'Size', align: 'right', sortValue: r => r.t.qty, render: r => <span className="text-textPrimary">{r.t.qty}</span> },
      { key: 'inout', header: 'In → out', align: 'right', render: r => <span className="text-textSecondary">{priceWordsOf(r, r.t.avgIn)} → {priceWordsOf(r, r.t.avgOut)}</span> },
      { key: 'held', header: 'Held', align: 'right', sortValue: r => r.t.heldMin / dayMinOf(r), render: r => <span className="text-textSecondary">{heldWords(r.t.heldMin, dayMinOf(r))}</span> },
      {
        key: 'worst',
        header: 'Most against',
        align: 'right',
        sortValue: r => excursionOf(r).worst.pnl,
        render: r => {
          const w = Math.min(0, excursionOf(r).worst.pnl);
          return <span className={w < 0 ? 'text-bear' : 'text-textMuted'} title="The most it was down while you held it">{w < 0 ? usdSigned(w, 0) : 'never down'}</span>;
        },
      },
      {
        key: 'best',
        header: 'Most for',
        align: 'right',
        sortValue: r => excursionOf(r).best.pnl,
        render: r => {
          const b = Math.max(0, excursionOf(r).best.pnl);
          return <span className={b > 0 ? 'text-bull' : 'text-textMuted'} title="The most it was up while you held it">{b > 0 ? usdSigned(b, 0) : 'never up'}</span>;
        },
      },
      { key: 'how', header: 'Ended', sortValue: r => r.t.how, render: r => <span className="text-textSecondary">{ENDED[r.t.how]}</span> },
      { key: 'pnl', header: 'Made or lost', align: 'right', sortValue: r => r.t.pnl, render: r => <span className={`font-semibold ${dirInk(r.t.pnl)}`}>{usdSigned(r.t.pnl)} <span className="text-t10 font-normal opacity-80">{r.t.r != null ? rWords(r.t.r) : 'no R'}</span></span> },
    ],
    [source.containerWord]
  );
  /* the day's grid says the clock alone — its date is the card's head */
  const dayColumns = useMemo<Column<JournalRow>[]>(() => columns.map(c => (c.key === 'closed' ? { ...c, header: 'Closed', render: (r: JournalRow) => <span className="text-textSecondary">{whenWords(r, r.t.closed).split(' · ')[1] ?? whenWords(r, r.t.closed)}</span> } : c)), [columns]);

  const exportCsv = () => {
    const csv = csvOf(newestFirst, r => {
      const e = excursionOf(r);
      return { best: e.best.pnl, worst: e.worst.pnl };
    });
    const who = account ? `-${nameOfAccount(account).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
    saveFile(`slayer-${kind}-journal${who}-${period}-${today}.csv`, csv);
  };
  /* the day's notes: today's (the plan before it, the review after), or the open day's, brought into view */
  const openNotes = () => {
    if (livePicked !== today) openDay(today);
    window.setTimeout(() => document.querySelector('[data-journal-day-notes]')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }), SWAP_OUT_MS + 80);
  };
  const csvWhyNot = rows.length ? null : source.rows.length ? 'none this period — nothing closed in it to put in a file' : 'nothing yet — nothing has closed on this journal';
  /* a journal of one account opens that account's own desk */
  const deskPath = account ? source.containerPath(account) : kind === 'paper' ? '/practice/paper' : '/practice/backtest';
  const deskWord = kind === 'paper' ? 'Paper page' : 'Backtest page';
  const testId = kind === 'paper' ? 'paper-journal' : 'review-journal';

  return (
    <div className="flex flex-col gap-3" data-journal-home={liveKind} data-period={livePeriod} data-journal-drawn={drawn.key}>
      {/* ---- THE HEAD: the period, the account, what it made ---- */}
      <TraceBox
        title={title}
        sub={`${spanWords}${clockWords}${whose ? ` · ${whose}` : ''}`}
        testId={testId}
        data={{ trades: rows.length }}
        facts={
          <>
            <Fact label="Made or lost" testId="journal-net">
              <span className={`text-t14 font-semibold ${dirInk(stats.net)}`}>{stats.n ? usdSigned(stats.net) : '—'}</span>
            </Fact>
            <Fact label="Trades" testId="journal-trades">{stats.n || '—'}</Fact>
            <Fact label="Won" testId="journal-won">{stats.n ? `${stats.wins} of ${stats.n} · ${pct(stats.winRate)}` : '—'}</Fact>
            <Fact label="Profit factor" title="What the winners made, over what the losers lost" testId="journal-pf">
              {!stats.n ? '—' : stats.profitFactor == null ? (stats.wins ? 'no losses' : '—') : stats.profitFactor.toFixed(2)}
            </Fact>
          </>
        }
        controls={
          <>
            {/* WHICH JOURNAL: the book (paper, backtest, your own) and the account or session in it — never mixed */}
            <JournalPicker pick={livePick} onPick={pickJournal} onNew={openNew} />
            <PeriodPick value={livePeriod} onChange={v => set({ period: v === 'month' ? null : v })} />
            <EndDoors
              onNotes={missing ? undefined : openNotes}
              onCsv={exportCsv}
              csvWhyNot={missing ? 'nothing — this journal is gone' : csvWhyNot}
              csvTitle="This period’s trades as a file a spreadsheet opens — with your tags and your words"
              extra={
                /* YOUR OWN TRADING: a broker's CSV brought into a journal of your own (JournalManual reads `import=1`) */
                <Link to="?journal=manual&import=1" className={door} title="Bring your real trading in from your broker’s CSV — into a journal of your own, kept apart from paper and backtest" data-journal-import-csv>
                  <FileUp className="w-3 h-3" /> Import a CSV
                </Link>
              }
            />
          </>
        }
        sentence={
          missing ? (
            <>{missing.was ? `${missing.was.name} is gone.` : 'This journal is not in this browser.'}</>
          ) : source.rows.length === 0 ? (
            <>
              Nothing closed yet. Trade on the{' '}
              <Link to={deskPath} className="text-textPrimary font-semibold hover:text-silver transition-colors">
                {deskWord}
              </Link>{' '}
              and each trade lands here the moment it closes — on its day in the calendar.
            </>
          ) : rows.length === 0 ? (
            <>Nothing closed {period === 'all' ? 'on this account yet' : period === 'today' ? 'today' : period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'this year'}. The calendar still has every day — press one to open it.</>
          ) : (
            <>
              {lead} you closed {stats.n} {stats.n === 1 ? 'trade' : 'trades'}
              {accountsIn > 1 ? ` on ${accountsIn} ${source.containerWord}s` : ''} and {stats.net >= 0 ? 'made' : 'lost'} <span className={`font-semibold ${dirInk(stats.net)}`}>{usd(stats.net)}</span>.
              {periodDays.size > 1 && best && worst && (
                <>
                  {' '}
                  Your best day was {shortDay(best.day)} (<span className={dirInk(best.net)}>{usdSigned(best.net, 0)}</span>), your worst {shortDay(worst.day)} (<span className={dirInk(worst.net)}>{usdSigned(worst.net, 0)}</span>).
                </>
              )}
              {stats.maxDrawdown > 0 && <> The most you gave back from a high was {usd(stats.maxDrawdown)}.</>}
            </>
          )
        }
      >
        {null}
      </TraceBox>

      {missing ? (
        <GoneJournal kind={kind} id={missing.id} was={missing.was} notes={source.notesOf(missing.id)} onBack={() => pickJournal({ book: kind, id: null })} />
      ) : (
      <>
      {/* THE MONTH, and the period's figures beside it — ONE ROW, the two ending level: the calendar's weeks grow
          to the figures' height, the figures' groups spread to the calendar's */}
      {/* side by side only from 1400px: at lg the calendar had ~430px for eight columns (33px a day), at xl 638px (69px a
          day — a four-figure day is 60px wide at 14px and spilled); from 1400 a day has 86px+, at 1440 the 92px he saw */}
      <div className="grid gap-3 items-stretch min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
        <Swap key={monthKey} out={monthOut} late={alive.current} className="min-w-0 min-h-0" data-journal-month-region>
          <JournalCalendar month={month} onMonth={m => set({ month: m === home ? null : m })} home={home} days={days} today={today} picked={livePicked} onPick={openDay} noted={noted} />
        </Swap>
        <Swap key={periodKey} out={periodOut} late={alive.current} className="min-w-0 min-h-0" data-journal-stats-region>
          <JournalStats rows={rows} periodDays={periodDays} periodLabel={periodLabel} />
        </Swap>
      </div>

      {/* ---- THE DAY, under the month, across the page ---- */}
      {picked && (
        <Swap key={dayKey} out={dayOut} late={alive.current} data-journal-day-region>
          <JournalDay day={picked} total={pickedTotal} holders={holders} onDayNote={source.setDayNote} onOpen={openTrade} onClose={() => openDay(null)} today={today} columns={dayColumns} testId={testId} />
        </Swap>
      )}

      {/* The period, drawn · FIVE CUTS · EVERY TRADE — one region, all of it the period's */}
      <Swap key={`rest|${periodKey}`} out={periodOut} late={alive.current} className="flex flex-col gap-3" data-journal-period-region>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-journal-period-drawn>
        <div className={`${card} flex flex-col min-w-0`}>
          <div className={chartHead}>
            <span className={headWord}>The running total</span>
            <span className="font-mono text-t10 text-textMuted">a point a trade, in the order they closed · a press opens its day</span>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 pb-5 h-[236px] flex items-center justify-center font-mono text-t10 text-textMuted">Nothing closed in this period</div>
          ) : (
            <div className="px-5 pb-5" data-journal-running>
              <SessionsChart
                points={runPoints}
                kind="baseline"
                ink="rgb(var(--bull))"
                inkBelow="rgb(var(--bear))"
                height={260}
                clock={oneDay ? 'clock' : 'span'}
                range={runRange}
                zone="ny"
                scale="pnl"
                curved
                cardW={236}
                cardH={98}
                testId="journal-running"
                onPick={t => {
                  const p = runBy.get(t);
                  if (p?.row) openDay(calendarDayOf(p.row));
                }}
                card={h => {
                  const p = runBy.get(h.time);
                  if (!p) return null;
                  if (!p.row) return <div className="font-mono text-t11 text-textSecondary">Before the period’s first close — nothing made, nothing lost</div>;
                  return (
                    <div className="font-mono text-t11 tnum">
                      <div className="text-t10 text-textMuted">{fmtStampLocal(instantOf(p.row, p.row.t.closed) as UTCTimestamp, 'ny')} · New York</div>
                      <div className="mt-0.5 text-textPrimary truncate">{titleOf(p.row)}</div>
                      <div className={`mt-0.5 font-semibold ${dirInk(p.row.t.pnl)}`}>{usdSigned(p.row.t.pnl)} on it</div>
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
            <span className="font-mono text-t10 text-textMuted">{oneDay && rows.length ? 'one day in this period' : 'a bar a day · a press opens the day'}</span>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 pb-5 h-[260px] flex items-center justify-center text-center font-mono text-t10 text-textMuted">Nothing closed in this period</div>
          ) : (
            <div className="px-5 pb-4 pt-2" data-journal-daily>
              <JournalBars days={daily} picked={livePicked} onPick={openDay} height={260} />
            </div>
          )}
        </div>
      </div>

      {/* ---- FIVE CUTS of the period's trades ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-6" data-journal-cuts>
        <JournalLanes title="By the hour you got in" lanes={hours} rest="The hour each trade was opened, on New York’s clock" testId="hour" />
        <JournalLanes title="By weekday" lanes={weekdays} rest="The day each trade closed on" testId="weekday" />
        <JournalLanes title="By name" lanes={names} rest="What you traded — the most traded first" testId="name" />
        <JournalLanes title="Long or short" lanes={sides} rest="Longs and calls needed it up; shorts and puts, down" testId="side" />
        <JournalLanes title="Sizes of wins and losses" lanes={sizes.lanes} measure="count" labelW={122} rest={`How often a trade is a big one — cut at ${usd(sizes.step, 0)} steps`} testId="size" />
        <JournalLanes title="By setup" lanes={setups} labelW={122} rest="Your own tags, counted — the setup each trade was written down as" testId="setup" />
        {perAccount && <JournalLanes title={`By ${source.containerWord}`} lanes={perAccount} labelW={122} rest={`What each ${source.containerWord} made in the period — pick one above for its own journal`} testId="account" />}
      </div>

      {/* Every trade in the period */}
      <div className={`${card} flex flex-col min-w-0`} data-journal-trades>
        <div className={chartHead}>
          <span className={headWord}>The trades</span>
          <span className="font-mono text-t10 tnum text-textMuted">{rows.length}</span>
          <span className="ml-auto font-mono text-t10 text-textMuted truncate">a row opens the trade — its chart, what it did while you held it, your tags and your words</span>
        </div>
        <TraceGrid rows={cap.shown} columns={columns} rowKey={r => r.key} onRowClick={openTrade} autoHeight animate={false} widths={{ qty: 64, held: 96, closed: 150, inout: 176 }} emptyText="Nothing closed in this period" testId={testId} />
        <RestFoot cap={cap} noun="trades" testId={testId} />
      </div>
      </Swap>
      </>
      )}
      <p className="px-1 font-mono text-t10 text-textMuted">{source.foot}</p>
    </div>
  );
};


/** A journal whose account or session was deleted on its own page: what the journal last saw of it, and the reader's day
    notes on it, which the journal keeps */
const GoneJournal = ({ kind, id, was, notes, onBack }: { kind: JournalKind; id: string; was: { name: string; n: number; net: number; at: number } | null; notes: Record<string, DayNote>; onBack: () => void }) => {
  const word = kind === 'paper' ? 'paper account' : 'backtest session';
  const kept = Object.entries(notes)
    .filter(([, n]) => (n.plan ?? '').trim() || (n.review ?? '').trim())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return (
    <div className={`${card} flex flex-col min-w-0`} data-journal-gone={id}>
      <EmptyBox
        title={was ? `${was.name} was deleted` : `No such ${word} here`}
        reason={
          was ? (
            <>
              This {word} was deleted on the {kind === 'paper' ? 'Paper' : 'Backtest'} page, and its trades went with it. When the journal last saw it ({asOfText(was.at, '')}) it had {was.n} closed {was.n === 1 ? 'trade' : 'trades'}
              {was.n ? <>, <span className={dirInk(was.net)}>{usdSigned(was.net)}</span> in all</> : null}.{kept.length ? ' Your day notes on it are kept below.' : ''}
            </>
          ) : (
            <>The link names a {word} this browser does not hold — it may have been made in another browser, or deleted before the journal saw it.</>
          )
        }
        action={
          <button type="button" onClick={onBack} className="tap-40 inline-flex items-center h-8 px-3 rounded-md border border-borderMuted text-t12 font-medium text-textPrimary hover:bg-ink/[0.05]" data-journal-gone-back>
            {kind === 'paper' ? 'All paper accounts' : 'All backtest sessions'}
          </button>
        }
      />
      {kept.length > 0 && (
        <div className="border-t border-borderSubtle/70 px-5 py-4 flex flex-col gap-3" data-journal-gone-notes={kept.length}>
          <span className={headWord}>Your day notes on it</span>
          {kept.map(([day, n]) => (
            <div key={day} className="flex flex-col gap-1 min-w-0">
              <span className="font-mono text-t11 text-textSecondary">{shortDay(day)}</span>
              {n.plan?.trim() && <p className="text-t12 text-textPrimary break-words"><span className="text-textMuted">Plan · </span>{n.plan}</p>}
              {n.review?.trim() && <p className="text-t12 text-textPrimary break-words"><span className="text-textMuted">Review · </span>{n.review}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
