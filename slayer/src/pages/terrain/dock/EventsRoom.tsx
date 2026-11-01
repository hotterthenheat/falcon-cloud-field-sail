import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import CompanyLogo from '../../../components/ui/CompanyLogo';
import FilterTabs from '../../../components/ui/FilterTabs';
import { ImpactMark } from '../../../components/record/impactMark';
import { now } from '../../../core/clock';
import { nyParts } from '../../../core/nyTime';
import { nyInstant, regularCloseMin } from '../../../core/session';
import type { EarningsEvent } from '../../../data/earnings';
import { useEarningsPending, useEveryReport } from '../../../data/earningsFeed';
import { useEconFeed } from '../../../data/liveRecord';
import { peekEntry, useBookRev } from '../../../data/book/store';
import type { EconEvent } from '../../../data/newsroom';
import { moneyM } from '../../record/money';
import { minuteClock } from '../sessionsClock';
import { Chip, ColHeads, DayHead, EmptyLine, SlotMark, reportOutAt, slotWords, untilShort } from './dockParts';

/*
==================================================
  SLAYER TERMINAL - THE EVENTS ROOM (pages/terrain/dock/EventsRoom.tsx)

  What lands when, on one clock (ported from the partner tree, 2026-10-31), on OUR feeds:

    MACRO     the economic calendar the Dossier reads (data/liveRecord.ts useEconFeed — the one shared read)
    EARNINGS  the fortnight's reports (data/earningsFeed.ts useEveryReport), each at its out-mark
    EXPIRIES  the active name's listed expiries, when the live book already holds them (data/book/store.ts — the book
              the pane drew; nothing is read for the room), each at that day's regular close (13:00 on an early close)

    THE SCOPE — This desk (dollar macro, the desk's names' reports, the name's expiries) · All · Major.
    THE ROW — the impact mark, New York time, the event with its line (the prior, the region when not the dollar, the
      cap on a report), EXP the forecast or the implied move, ACT the countdown — or "out" once it printed (the
      calendar carries no actuals, so none is invented). Today's past events fold under "Earlier today".
==================================================
*/

type Scope = 'desk' | 'all' | 'major';
type Kind = 'macro' | 'earnings' | 'expiry';
type Tier = 'high' | 'medium' | 'low';
const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: 'desk', label: 'This desk' },
  { value: 'all', label: 'All' },
  { value: 'major', label: 'Major' },
];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GRID = '18px 46px minmax(0, 1fr) 58px 58px';

interface Row {
  id: string;
  kind: Kind;
  at: number;
  tier: Tier;
  time: string;
  slot?: { slot: EarningsEvent['slot']; timeKnown?: boolean };
  logo?: string;
  title: string;
  sub: string;
  exp: string;
  door: string;
  desk: boolean;
  major: boolean;
  weight?: number;
}
const TIER_RANK: Record<Tier, number> = { high: 2, medium: 1, low: 0 };

const dayKeyOf = (at: number) => {
  const p = nyParts(at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};
const dayLabelOf = (at: number) => {
  const p = nyParts(at);
  return `${DAY[p.weekday]} ${p.day} ${MONTH[p.month - 1]}`;
};
/** the third Friday — the monthly expiry */
const monthly = (iso: string): boolean => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === 5 && d >= 15 && d <= 21;
};

const macroRows = (events: EconEvent[]): Row[] =>
  events
    .filter(e => Number.isFinite(e.atMs))
    .map(e => ({
      id: e.id,
      kind: 'macro' as const,
      at: e.atMs,
      tier: e.impact,
      time: e.timeLabel,
      title: e.title,
      sub: [e.previous ? `Prev ${e.previous}` : '', e.region !== 'USD' ? e.region : ''].filter(Boolean).join(' · '),
      exp: e.forecast ?? '—',
      door: '/dossier/news',
      desk: e.region === 'USD',
      major: e.impact === 'high',
    }));

const reportRows = (reports: EarningsEvent[], deskNames: Set<string>): Row[] =>
  reports.flatMap(e => {
    const at = reportOutAt(e.iso, e.slot, e.timeKnown);
    if (at === null || e.fund) return [];
    const big = (e.marketCap ?? 0) >= 50e9;
    const implied = Number.isFinite(e.impliedMovePct) && e.impliedMovePct > 0 ? `±${e.impliedMovePct.toFixed(1)}%` : '—';
    return [
      {
        id: `rep-${e.ticker}-${(e.iso ?? '').slice(0, 10)}`,
        kind: 'earnings' as const,
        at,
        tier: (big ? 'high' : e.known ? 'medium' : 'low') as Tier,
        time: slotWords(e.slot, e.timeKnown),
        slot: { slot: e.slot, timeKnown: e.timeKnown },
        logo: e.ticker,
        title: `${e.name} reports`,
        sub: `${e.ticker}${e.marketCap ? ` · ${moneyM(e.marketCap / 1e6)}` : ''}${e.nextEpsEst != null ? ` · EPS est ${e.nextEpsEst.toFixed(2)}` : ''}`,
        exp: implied,
        weight: e.marketCap ?? 0,
        door: `/dossier/earnings/${e.ticker}`,
        desk: deskNames.has(e.ticker),
        major: big,
      },
    ];
  });

const expiryRows = (ticker: string, expiries: { date: string; dte: number }[]): Row[] =>
  expiries.slice(0, 10).flatMap(x => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return [];
    const close = regularCloseMin(x.date);
    return [
      {
        id: `exp-${ticker}-${x.date}`,
        kind: 'expiry' as const,
        at: nyInstant(x.date, close),
        tier: (monthly(x.date) ? 'medium' : 'low') as Tier,
        time: minuteClock(close),
        logo: ticker,
        title: `${ticker} options expire`,
        sub: monthly(x.date) ? 'the monthly expiry' : 'a listed expiry',
        exp: x.dte === 0 ? '0DTE' : `${x.dte} DTE`,
        door: '/terrain',
        desk: true,
        major: false,
      },
    ];
  });

const EventsRoom = ({ names, ticker }: { names: string[]; ticker: string }) => {
  const navigate = useNavigate();
  const econ = useEconFeed();
  const reports = useEveryReport();
  const reportsPending = useEarningsPending();
  const bookRev = useBookRev();
  const [scope, setScope] = useState<Scope>('desk');
  const [kinds, setKinds] = useState<Set<Kind>>(() => new Set());
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [at, setAt] = useState(() => now().getTime());
  useEffect(() => {
    const id = window.setInterval(() => setAt(now().getTime()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const deskNames = useMemo(() => new Set(names.map(n => n.toUpperCase())), [names]);
  /* the name's listed expiries, as the live book holds them — none read for the room */
  const expiries = useMemo(() => {
    const e = peekEntry(ticker);
    return e && e.status === 'live' ? e.expiries : [];
  }, [ticker, bookRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const haveExpiries = expiries.length > 0;
  const econEvents = econ.status === 'live' ? econ.events : [];
  const minute = Math.floor(at / 60_000);

  const rows = useMemo(() => {
    const all = [...macroRows(econEvents), ...reportRows(reports, deskNames), ...expiryRows(ticker, expiries)];
    return all
      .filter(r => (scope === 'all' ? r.kind !== 'earnings' || r.tier !== 'low' : scope === 'major' ? r.major : r.desk))
      .filter(r => kinds.size === 0 || kinds.has(r.kind))
      .filter(r => r.at > at - 10 * 3_600_000)
      .sort((a, b) => a.at - b.at || TIER_RANK[b.tier] - TIER_RANK[a.tier] || (b.weight ?? 0) - (a.weight ?? 0) || a.title.localeCompare(b.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [econEvents, reports, deskNames, ticker, expiries, scope, kinds, minute]);

  const earlier = rows.filter(r => r.at <= at);
  const ahead = rows.filter(r => r.at > at);
  const days = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const r of ahead) by.set(dayKeyOf(r.at), [...(by.get(dayKeyOf(r.at)) ?? []), r]);
    return [...by.entries()].map(([key, list]) => ({ key, label: dayLabelOf(list[0].at), list }));
  }, [ahead]);
  const todayKey = dayKeyOf(at);
  const toggleKind = (k: Kind) =>
    setKinds(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const row = (r: Row) => (
    <button
      key={r.id}
      type="button"
      onClick={() => navigate(r.door)}
      className="grid items-center w-full text-left px-3 gap-x-2 h-11 border-b border-borderSubtle/50 hover:bg-ink/[0.04] transition-colors"
      style={{ gridTemplateColumns: GRID }}
      data-dock-event={r.id}
      data-kind={r.kind}
    >
      <span className="flex items-center justify-center">
        <ImpactMark tier={r.tier} />
      </span>
      <span className="flex items-start gap-1 min-w-0">
        {r.slot && <SlotMark slot={r.slot.slot} timeKnown={r.slot.timeKnown} className="w-2.5 h-2.5 mt-px shrink-0" />}
        <span className={r.slot ? 'text-t9 leading-[1.2] text-textSecondary' : 'font-mono text-t11 tnum text-textSecondary'}>{r.slot ? (r.slot.timeKnown === false ? 'unset' : r.slot.slot === 'BMO' ? 'before' : 'after') : r.time}</span>
      </span>
      <span className="flex items-center gap-2 min-w-0">
        {r.logo && <CompanyLogo ticker={r.logo} size={18} />}
        <span className="min-w-0">
          <span className="block text-t12 font-semibold text-textPrimary truncate leading-[1.2]">{r.title}</span>
          <span className="block font-mono text-t95 tnum text-textMuted truncate leading-[1.2]">{r.sub || ' '}</span>
        </span>
      </span>
      <span className="font-mono text-t11 tnum text-textSecondary text-right truncate">{r.exp}</span>
      <span className={`font-mono text-t11 font-semibold tnum text-right ${r.at <= at ? 'text-textMuted' : 'text-textPrimary'}`}>{r.at <= at ? 'out' : untilShort(r.at - at)}</span>
    </button>
  );

  const loading = econ.status === 'loading' && reportsPending;
  const failed = econ.status !== 'live' && econ.status !== 'loading' && reports.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-dock-room="events">
      <div className="shrink-0 px-3 pt-2 pb-1.5">
        <FilterTabs options={SCOPES} value={scope} onChange={setScope} ariaLabel="Which events" size="sm" />
      </div>
      <div className="shrink-0 flex items-center gap-1.5 px-3 pb-2 flex-wrap">
        <Chip on={kinds.size === 0} onClick={() => setKinds(new Set())}>
          All
        </Chip>
        <Chip on={kinds.has('macro')} onClick={() => toggleKind('macro')} title="The economic calendar">
          Macro
        </Chip>
        <Chip on={kinds.has('earnings')} onClick={() => toggleKind('earnings')} title="The fortnight's reports">
          Earnings
        </Chip>
        {haveExpiries && (
          <Chip on={kinds.has('expiry')} onClick={() => toggleKind('expiry')} title={`${ticker}'s listed expiries`}>
            Expiries
          </Chip>
        )}
        <span className="ml-auto font-mono text-t10 tnum text-textMuted" data-dock-events-count>
          {ahead.length} ahead
        </span>
      </div>
      <ColHeads grid={GRID} cols={[{ label: 'Imp' }, { label: 'Time' }, { label: 'Event' }, { label: 'Exp', right: true }, { label: 'Act', right: true }]} />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-dock-events-rows>
        {earlier.length > 0 && (
          <section aria-label="Earlier today">
            <button type="button" onClick={() => setEarlierOpen(v => !v)} aria-expanded={earlierOpen} className="flex items-center gap-1.5 w-full h-8 px-3 text-left border-b border-borderSubtle/60 hover:bg-ink/[0.03] transition-colors" data-dock-earlier>
              {earlierOpen ? <ChevronDown className="w-3 h-3 text-textMuted" /> : <ChevronRight className="w-3 h-3 text-textMuted" />}
              <span className="text-t12 font-semibold text-textSecondary">Earlier</span>
              <span className="font-mono text-t10 tnum text-textMuted">{earlier.length}</span>
            </button>
            {earlierOpen && earlier.map(row)}
          </section>
        )}
        {days.length === 0 && earlier.length === 0 ? (
          <EmptyLine>
            {loading
              ? 'Reading the calendars…'
              : failed
                ? 'The calendars did not answer.'
                : scope === 'desk'
                  ? 'Nothing ahead for this desk in the window the calendars cover.'
                  : 'Nothing ahead fits the cut.'}
          </EmptyLine>
        ) : (
          days.map(d => (
            <section key={d.key} aria-label={d.label}>
              <DayHead label={d.label} facts={`${d.list.length} ${d.list.length === 1 ? 'event' : 'events'}`}>
                {d.key === todayKey && <span className="font-mono text-t9 uppercase tracking-widest text-silver">today</span>}
              </DayHead>
              {d.list.map(row)}
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default EventsRoom;
