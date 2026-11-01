import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CompanyLogo from '../../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../../components/ui/DropdownSelect';
import FilterTabs from '../../../components/ui/FilterTabs';
import { stateOf } from '../../../components/earnings/volState';
import { now } from '../../../core/clock';
import { nyIsoDate } from '../../../core/nyTime';
import type { EarningsEvent, ReportSlot } from '../../../data/earnings';
import { MIN_PRICED_PRINTS, ensureLastWeek, reportedNow, useEarningsFailed, useEarningsPending, useEveryReport, useLiveReactions } from '../../../data/earningsFeed';
import { useNameWatch } from '../../../data/nameWatch';
import { boardMondayIso } from '../../../data/nyDate';
import type { Sector } from '../../../data/universe';
import { moneyM } from '../../record/money';
import { Chip, ColHeads, DayHead, EmptyLine, SearchField, SlotMark, reportOutAt, slotWords, untilShort } from './dockParts';

/*
==================================================
  SLAYER TERMINAL - THE EARNINGS ROOM (pages/terrain/dock/EarningsRoom.tsx)

  The week's reports beside the charts (ported from the partner tree, 2026-10-31), on OUR earnings feed — the
  fortnight every earnings page reads (data/earningsFeed.ts useEveryReport: the same shared store, no read of its own;
  last week is read only on the ask, as the Dossier does). Narrow by rest, so the row is four columns, not five: the
  name's mark · the company with its slot and facts · WHEN · MOVE.

    THE SCOPE — This desk (every name on the panes), Watchlist, All, Major (the names the room would recognise).
    THE WEEK — Monday to Friday, each day its count, paged ‹ ›; a day pressed glides the list to its group, and the
      strip marks the day at the top as the list scrolls.
    THE CUTS — a name search, before the open / after the close, the sector.
    THE ROW — the Dossier's slot mark and words (no clock is given by the vendor, so none is invented); WHEN a countdown
      to the out-mark (the regular open before the open, the close after it — the session module's, so an early close
      counts to 13:00) or the session's reaction once out; MOVE the implied move in the Dossier's priced ink over the
      typical move of the last prints. A row opens the name's earnings page.

  Nothing live, nothing drawn: "Reading the calendar…" while the feed is out, "The calendar did not answer." when it
  failed, and an empty cut says which cut is empty.
==================================================
*/

type Scope = 'desk' | 'watch' | 'all' | 'major';
const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: 'desk', label: 'This desk' },
  { value: 'watch', label: 'Watchlist' },
  { value: 'all', label: 'All' },
  { value: 'major', label: 'Major' },
];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = [1, 2, 3, 4, 5] as const;
const GRID = '22px minmax(0, 1fr) 66px 72px';
const PRICED_INK = { RICH: 'text-warn', INLINE: 'text-textPrimary', CHEAP: 'text-bull' } as const;

/** The ISO date of a weekday in a board week (0 = this week, ±1 the ones beside it) */
const dayIso = (weekIdx: number, weekday: number): string => {
  const [y, m, d] = boardMondayIso().split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + weekIdx * 7 + (weekday - 1), 12));
  return at.toISOString().slice(0, 10);
};
const dayLabel = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DAY[at.getUTCDay()]} ${d} ${MONTH[m - 1]}`;
};
const histN = (e: EarningsEvent) => (e.history === false ? 0 : e.histCount ?? e.pastMoves.length);
const pricedKnown = (e: EarningsEvent) => !e.reported && histN(e) >= MIN_PRICED_PRINTS && e.richness > 0;
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

/* memo: a row redraws only when its report or the half-minute clock changes — the strip's mark moving as the list
   scrolls must not redraw every row */
const Row = memo(({ e, at, onOpen }: { e: EarningsEvent; at: number; onOpen: (t: string) => void }) => {
  const out = reportedNow(e);
  const target = reportOutAt(e.iso, e.slot, e.timeKnown);
  const typical = histN(e) > 0 && e.histAvgMovePct > 0;
  const moveInk = pricedKnown(e) ? PRICED_INK[stateOf(e)] : 'text-textPrimary';
  const reaction = e.actualMovePct;
  const implied = Number.isFinite(e.impliedMovePct) && e.impliedMovePct > 0 ? e.impliedMovePct : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(e.ticker)}
      className="grid items-center w-full text-left px-3 gap-x-2 h-[50px] border-b border-borderSubtle/50 hover:bg-ink/[0.04] transition-colors"
      style={{ gridTemplateColumns: GRID }}
      data-dock-report={e.ticker}
      title={`Open ${e.ticker}'s earnings page`}
    >
      <CompanyLogo ticker={e.ticker} size={22} />
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-t12 font-semibold text-textPrimary truncate">{e.name}</span>
          <span className="font-mono text-t10 text-textMuted shrink-0">{e.ticker}</span>
        </span>
        <span className="flex items-center gap-1 font-mono text-t10 tnum text-textMuted min-w-0">
          <SlotMark slot={e.slot} timeKnown={e.timeKnown} className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">
            {slotWords(e.slot, e.timeKnown)} · {e.marketCap ? moneyM(e.marketCap / 1e6) : '—'}
            {(e.estimated || !e.confirmed) && <span className="text-warn"> · date estimated</span>}
          </span>
        </span>
      </span>
      <span className="text-right min-w-0">
        {out ? (
          <>
            <span className={`block font-mono text-t11 font-semibold tnum ${reaction == null ? 'text-textSecondary' : reaction >= 0 ? 'text-bull' : 'text-bear'}`}>{reaction == null ? 'out' : signedPct(reaction)}</span>
            <span className="block font-mono text-t9 text-textMuted">{reaction == null ? 'reported' : e.moveLive ? 'reacting' : 'reaction'}</span>
          </>
        ) : (
          <>
            <span className="block font-mono text-t11 font-semibold tnum text-textPrimary">{target ? untilShort(target - at) : '—'}</span>
            <span className="block font-mono text-t9 text-textMuted">{e.timeKnown === false ? 'time not set' : e.slot === 'BMO' ? 'to the open' : 'to the close'}</span>
          </>
        )}
      </span>
      <span className="text-right min-w-0">
        <span className={`block font-mono text-t11 font-semibold tnum ${moveInk}`}>{implied != null ? `±${implied.toFixed(1)}%` : '—'}</span>
        <span className="block font-mono text-t9 tnum text-textMuted truncate">{typical ? `±${e.histAvgMovePct.toFixed(1)}% typ` : 'implied'}</span>
      </span>
    </button>
  );
});
Row.displayName = 'EarningsDockRow';

const EarningsRoom = ({ names }: { names: string[] }) => {
  const navigate = useNavigate();
  const openName = useCallback((t: string) => navigate(`/dossier/earnings/${t}`), [navigate]);
  const every = useEveryReport();
  const pending = useEarningsPending();
  const failed = useEarningsFailed();
  const watch = useNameWatch();
  const [scope, setScope] = useState<Scope>('major');
  const [weekIdx, setWeekIdx] = useState<-1 | 0 | 1>(0);
  const [dayInView, setDayInView] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /* the glide in flight (its cancel), null at rest — the spy stays quiet while a glide passes the days between */
  const gliding = useRef<(() => void) | null>(null);
  const [q, setQ] = useState('');
  const [slots, setSlots] = useState<Set<ReportSlot>>(() => new Set());
  const [sector, setSector] = useState<Sector | 'any'>('any');
  const [at, setAt] = useState(() => now().getTime());
  useEffect(() => {
    const id = window.setInterval(() => setAt(now().getTime()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (weekIdx === -1) ensureLastWeek();
  }, [weekIdx]);

  const deskNames = useMemo(() => new Set(names.map(n => n.toUpperCase())), [names]);
  const watched = useMemo(() => new Set(watch.sections.flatMap(s => s.names).map(n => n.symbol.toUpperCase())), [watch]);
  const needle = q.trim().toUpperCase();
  const cut = useMemo(
    () =>
      every.filter(
        e =>
          e.weekIdx === weekIdx &&
          !e.fund &&
          (scope === 'all' ? true : scope === 'major' ? e.known : scope === 'desk' ? deskNames.has(e.ticker) : watched.has(e.ticker)) &&
          (slots.size === 0 || (e.timeKnown !== false && slots.has(e.slot))) &&
          (sector === 'any' || e.sector === sector) &&
          (!needle || e.ticker.includes(needle) || e.name.toUpperCase().includes(needle))
      ),
    [every, weekIdx, scope, deskNames, watched, slots, sector, needle]
  );
  useLiveReactions(cut);
  const sectors = useMemo(() => Array.from(new Set(every.filter(e => e.weekIdx === weekIdx).map(e => e.sector))).sort(), [every, weekIdx]);
  const sectorOptions: DropdownOption<Sector | 'any'>[] = [{ value: 'any', label: 'Any sector' }, ...sectors.map(s => ({ value: s, label: s }))];

  const days = useMemo(() => {
    const byDay = new Map<number, EarningsEvent[]>();
    for (const e of cut) byDay.set(e.weekday, [...(byDay.get(e.weekday) ?? []), e]);
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wd, list]) => {
        const rank = (e: EarningsEvent) => (e.timeKnown === false ? 2 : e.slot === 'BMO' ? 0 : 1);
        const sorted = [...list].sort((a, b) => rank(a) - rank(b) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
        const bmo = list.filter(e => e.timeKnown !== false && e.slot === 'BMO').length;
        const amc = list.filter(e => e.timeKnown !== false && e.slot === 'AMC').length;
        const facts = [`${list.length} ${list.length === 1 ? 'report' : 'reports'}`, bmo ? `${bmo} before` : '', amc ? `${amc} after` : ''].filter(Boolean).join(' · ');
        return { wd, iso: dayIso(weekIdx, wd), list: sorted, facts };
      });
  }, [cut, weekIdx]);

  const today = nyIsoDate(at);

  /* THE SCROLL SPY: the last day's section whose top has passed the scroller's top is the day in view */
  const spy = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const sections = Array.from(box.querySelectorAll<HTMLElement>('[data-dock-day-section]'));
    if (sections.length === 0) {
      setDayInView(null);
      return;
    }
    const top = box.scrollTop + 2;
    let hit = sections[0];
    for (const sec of sections) if (sec.offsetTop <= top) hit = sec;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) hit = sections[sections.length - 1];
    setDayInView(Number(hit.dataset.dockDaySection));
  }, []);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let raf = 0;
    const onScroll = () => {
      if (gliding.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(spy);
    };
    const onHand = () => {
      if (!gliding.current) return;
      gliding.current();
      gliding.current = null;
      spy();
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    box.addEventListener('wheel', onHand, { passive: true });
    box.addEventListener('pointerdown', onHand, { passive: true });
    spy();
    return () => {
      box.removeEventListener('scroll', onScroll);
      box.removeEventListener('wheel', onHand);
      box.removeEventListener('pointerdown', onHand);
      cancelAnimationFrame(raf);
      gliding.current?.();
      gliding.current = null;
    };
  }, [spy, days]);
  /** A day pressed: the strip marks it at once and the list glides to its group — an eased glide on a timer of frames
      that lands on the head to the pixel and yields to the wheel */
  const goToDay = (wd: number) => {
    const box = scroller.current;
    const sec = box?.querySelector<HTMLElement>(`[data-dock-day-section="${wd}"]`);
    if (!box || !sec) return;
    setDayInView(wd);
    gliding.current?.();
    const from = box.scrollTop;
    const to = Math.min(sec.offsetTop, box.scrollHeight - box.clientHeight);
    const dist = to - from;
    if (Math.abs(dist) < 1) return;
    const dur = Math.min(650, Math.max(280, Math.abs(dist) * 0.012));
    let t0 = -1;
    let raf = 0;
    const step = (t: number) => {
      if (t0 < 0) t0 = t;
      const k = Math.min(1, (t - t0) / dur);
      box.scrollTop = from + dist * (1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(step);
      else {
        gliding.current = null;
        spy();
      }
    };
    raf = requestAnimationFrame(step);
    gliding.current = () => cancelAnimationFrame(raf);
  };
  const toggleSlot = (s: ReportSlot) =>
    setSlots(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const weekWord = weekIdx === 0 ? 'this week' : weekIdx === 1 ? 'next week' : 'last week';

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-dock-room="earnings">
      <div className="shrink-0 px-3 pt-2 pb-1.5">
        <FilterTabs options={SCOPES} value={scope} onChange={setScope} ariaLabel="Whose reports" size="sm" />
      </div>
      <div className="shrink-0 flex items-stretch gap-1 px-3 pb-2" data-dock-week={weekIdx}>
        <button type="button" onClick={() => setWeekIdx(w => (w > -1 ? ((w - 1) as -1 | 0 | 1) : w))} disabled={weekIdx === -1} aria-label="The week before" className="inline-flex items-center justify-center w-5 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] disabled:opacity-30 transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {WEEKDAYS.map(wd => {
          const iso = dayIso(weekIdx, wd);
          const n = cut.filter(e => e.weekday === wd).length;
          const on = dayInView === wd;
          return (
            <button
              key={wd}
              type="button"
              onClick={() => goToDay(wd)}
              disabled={n === 0}
              aria-current={on ? 'true' : undefined}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center h-11 rounded-md border transition-colors disabled:opacity-40 ${
                on ? 'bg-ink/[0.08] border-transparent text-textPrimary' : 'border-borderSubtle/70 text-textSecondary enabled:hover:bg-ink/[0.04] enabled:hover:text-textPrimary'
              } ${iso === today ? 'ring-1 ring-silver/50' : ''}`}
              data-dock-weekday={wd}
              title={n ? `${dayLabel(iso)} · ${n} ${n === 1 ? 'report' : 'reports'} — scroll to the day` : `${dayLabel(iso)} · no report`}
            >
              <span className="font-mono text-t9 uppercase tracking-widest leading-none">{DAY[wd]}</span>
              <span className="mt-1 text-t12 font-semibold leading-none tnum">{Number(iso.slice(8, 10))}</span>
              <span className="mt-0.5 font-mono text-t9 leading-none tnum text-textMuted">{n}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setWeekIdx(w => (w < 1 ? ((w + 1) as -1 | 0 | 1) : w))} disabled={weekIdx === 1} aria-label="The week after" className="inline-flex items-center justify-center w-5 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] disabled:opacity-30 transition-colors">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="shrink-0 flex items-center gap-1.5 px-3 pb-2 flex-wrap">
        <SearchField value={q} onChange={setQ} placeholder="Ticker or name" width={112} />
        <Chip on={slots.has('BMO')} onClick={() => toggleSlot('BMO')} title="Only the reports before the open">
          <SlotMark slot="BMO" className="w-2.5 h-2.5" /> Before
        </Chip>
        <Chip on={slots.has('AMC')} onClick={() => toggleSlot('AMC')} title="Only the reports after the close">
          <SlotMark slot="AMC" className="w-2.5 h-2.5" /> After
        </Chip>
        <span className="ml-auto">
          <DropdownSelect<Sector | 'any'> label="Sector" value={sector} options={sectorOptions} onChange={setSector} size="sm" align="end" />
        </span>
      </div>
      <ColHeads grid={GRID} cols={[{ label: '' }, { label: 'Company' }, { label: 'When', right: true }, { label: 'Move', right: true }]} />
      <div ref={scroller} className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain" data-dock-earnings-rows>
        {days.length === 0 ? (
          <EmptyLine>
            {pending && every.length === 0
              ? 'Reading the calendar…'
              : failed && every.length === 0
                ? 'The calendar did not answer.'
                : scope === 'desk'
                  ? `No report ${weekWord} for the names on this desk.`
                  : scope === 'watch'
                    ? `No report ${weekWord} for a watched name.`
                    : `No report ${weekWord} fits the cut.`}
          </EmptyLine>
        ) : (
          days.map(d => (
            <section key={d.wd} aria-label={dayLabel(d.iso)} data-dock-day-section={d.wd}>
              <DayHead label={dayLabel(d.iso)} facts={d.facts}>
                {d.iso === today && <span className="font-mono text-t9 uppercase tracking-widest text-silver">today</span>}
              </DayHead>
              {d.list.map(e => (
                <Row key={`${e.ticker}-${e.iso ?? ''}`} e={e} at={at} onOpen={openName} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default EarningsRoom;
