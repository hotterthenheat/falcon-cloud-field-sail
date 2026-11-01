import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CalendarCheck, CalendarDays, Grid3x3, Hammer, Mountain, Newspaper, Receipt, Rows4, X } from 'lucide-react';
import CompanyLogo from '../../components/ui/CompanyLogo';
import SlowTip from '../../components/ui/SlowTip';
import ExposureField from '../../components/gex/ExposureField';
import RailBuilding from '../../components/gex/RailBuilding';
import { RegimeTabs } from '../../components/gex/regimeLazy';
import { LensSwitch, SurfaceLenses, keepLens, readLens, type SurfaceLens } from '../../components/gex/surfaceLazy';
import type { HeatMode } from '../../components/gex/heatmap';
import CatTag from '../../components/news/CatTag';
import { ImpactMark, tierOf } from '../../components/record/impactMark';
import { snapshotOf } from '../../data/book/feed';
import { useBookRev } from '../../data/book/store';
import { useTickerNews } from '../../data/liveRecord';
import { useNearReports } from '../../data/earningsFeed';
import { DOCK_ROOMS, setDockWidth, useDockWidth, type DockRoom } from './dockStore';
import EarningsRoom from './dock/EarningsRoom';
import EventsRoom from './dock/EventsRoom';

/*
==================================================
  SLAYER TERMINAL - THE DESK'S DOCK (pages/terrain/DeskDock.tsx)

  The column at the desk's right edge that the ticker bar's Panels door opens — the partner tree's dock (2026-11-01 port:
  its head, its grip, a width a room, one room at a time, the charts giving way beside it) over OUR rooms: the strike
  rail's own views (Matrix · Calendar · Surface · Regime · Building · Prints) at a reading width, the name's news, and
  the two calendars. Every room reads the ACTIVE pane's name and our own feeds — the book store, the regime feed,
  Pinpoint's stores, the wire. Not a drawer: it stands in the desk's row, so nothing covers a tape. Never over a
  fullscreen pane. On a phone it is a sheet over the foot of the page with the rooms as tabs in its head.
==================================================
*/

export const DOCK_META: Record<DockRoom, { title: string; sub: string; icon: ReactNode }> = {
  ladder: { title: 'Matrix', sub: 'put · call · net by strike', icon: <Rows4 /> },
  heat: { title: 'Calendar', sub: 'the book across its expiries', icon: <Grid3x3 /> },
  surface: { title: 'Surface', sub: 'gamma across spot · skew · drift', icon: <Mountain /> },
  regime: { title: 'Regime', sub: 'the VIX curve and its year', icon: <Activity /> },
  building: { title: 'Building', sub: 'overnight open interest', icon: <Hammer /> },
  prints: { title: 'Prints', sub: "the session's prints", icon: <Receipt /> },
  news: { title: 'News', sub: 'the wire on this name', icon: <Newspaper /> },
  earnings: { title: 'Earnings', sub: "the week's reports", icon: <CalendarCheck /> },
  events: { title: 'Events', sub: 'what lands when', icon: <CalendarDays /> },
};

interface Props {
  room: DockRoom;
  ticker: string;
  /** every name on the desk's panes — the calendars' "This desk" scope */
  names: string[];
  /** the desk's heat ramp and the page's theme, as the rails read them */
  mode: HeatMode;
  paper: boolean;
  onClose: () => void;
  onRoom: (room: DockRoom) => void;
  /** the phone's sheet instead of the desk's column */
  sheet?: boolean;
}

/* ── the book's faces: the matrix, the calendar and the gamma profile — the rail's field, the view locked ── */
const BookRoom = ({ ticker, view }: { ticker: string; view: 'matrix' | 'calendar' | 'profile' }) => {
  const bookRev = useBookRev();
  /* the rail's own pace: the field re-reads the book every ten seconds while the room is up */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);
  const snap = useMemo(() => (ticker ? snapshotOf(ticker) : null), [ticker, bookRev, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!snap || (snap.chain?.length ?? 0) === 0)
    return (
      <p className="flex-1 flex items-center justify-center px-6 text-center font-mono text-t12 text-textSecondary" data-dock-empty>
        No book on {ticker} yet. It comes in when the chain quotes.
      </p>
    );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1.5" data-dock-room={view}>
      <ExposureField snapshot={snap} toolbar="panel" viewLock={view} legsLock={view === 'matrix' ? 'all' : undefined} fullMode="portal" narrowHint="widen the panel or pick fewer" />
    </div>
  );
};

/* ── the surface: the rail's three lenses ── */
const SurfaceRoom = ({ ticker, mode, paper }: { ticker: string; mode: HeatMode; paper: boolean }) => {
  const [lens, setLensState] = useState<SurfaceLens>(readLens);
  const setLens = (v: SurfaceLens) => {
    setLensState(v);
    keepLens(v);
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-dock-room="surface">
      <div className="shrink-0 flex items-center px-2.5 h-9 border-b border-borderSubtle/60">
        <LensSwitch value={lens} onChange={setLens} />
      </div>
      {lens === 'gamma' && <BookRoom ticker={ticker} view="profile" />}
      {lens === 'skew' && (
        <div className="relative flex-1 min-h-0">
          <SurfaceLenses.Skew ticker={ticker} mode={mode} paper={paper} />
        </div>
      )}
      {lens === 'drift' && (
        <div className="relative flex-1 min-h-0">
          <SurfaceLenses.Drift ticker={ticker} />
        </div>
      )}
    </div>
  );
};

/* ── the news: the wire on the name, and its next report ── */
const whenWord = (minutesAgo: number) =>
  minutesAgo < 1 ? 'now' : minutesAgo < 60 ? `${Math.round(minutesAgo)}m` : minutesAgo < 60 * 24 ? `${Math.floor(minutesAgo / 60)}h` : `${Math.floor(minutesAgo / (60 * 24))}d`;

const NewsRoom = ({ ticker }: { ticker: string }) => {
  const navigate = useNavigate();
  const news = useTickerNews(ticker);
  const reports = useNearReports();
  const rows = news.status === 'live' ? news.events : [];
  const next = useMemo(() => reports.events.find(e => e.ticker === ticker) ?? null, [reports, ticker]);
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-dock-room="news">
      <div className="shrink-0 flex items-center gap-2 px-3.5 h-9 border-b border-borderSubtle/60 font-mono text-t10 tnum text-textMuted" data-dock-report>
        {next ? (
          <>
            <span className="text-textSecondary">Reports {next.dateLabel}</span>
            <span>· {next.slot === 'BMO' ? 'before the open' : 'after the close'}</span>
            <span className="ml-auto text-textSecondary">{next.daysOut === 0 ? 'today' : `in ${next.daysOut} ${next.daysOut === 1 ? 'session' : 'sessions'}`}</span>
          </>
        ) : (
          <span>{reports.status === 'loading' ? 'Reading the calendar…' : 'No report on the calendar ahead'}</span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-dock-news-rows>
        {rows.length === 0 ? (
          <p className="px-3.5 py-4 text-t11 leading-snug text-textMuted">
            {news.status === 'loading' ? 'Reading the wire…' : news.status === 'sim' ? 'The wire did not answer.' : `No headline on ${ticker} on the wire today.`}
          </p>
        ) : (
          rows.map(e => (
            <button
              key={e.id}
              type="button"
              onClick={() => navigate('/dossier/news', { state: { selectedId: e.id } })}
              className="w-full text-left px-3.5 py-2 border-b border-borderSubtle/60 hover:bg-ink/[0.04] transition-colors"
              data-dock-news-row={e.id}
              title="Open the story in the Dossier"
            >
              <span className="flex items-center gap-1.5 h-4">
                <ImpactMark tier={tierOf(e.severity)} />
                <span className="font-mono text-t10 tnum text-textMuted">{whenWord(e.item.minutesAgo)}</span>
                <span className="font-mono text-t10 text-textMuted truncate">{e.item.source}</span>
                <span className="ml-auto shrink-0">
                  <CatTag category={e.item.category} size={9} />
                </span>
              </span>
              <span className="block mt-0.5 text-t12 leading-snug text-textPrimary line-clamp-2">{e.item.headline}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

const Board = ({ children, room }: { children: ReactNode; room: DockRoom }) => (
  <div className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden" data-dock-room={room}>
    {children}
  </div>
);

const DeskDock = ({ room, ticker, names, mode, paper, onClose, onRoom, sheet = false }: Props) => {
  const meta = DOCK_META[room];
  const width = useDockWidth(room);
  /* THE GRIP: drag the dock's left edge; the width is the room's own and remembered. Pointer capture keeps the drag
     when the pointer outruns the 6px strip. */
  const grip = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDockWidth(room, startW + (startX - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <aside
      className={
        sheet
          ? 'fixed inset-x-0 bottom-0 z-[95] h-[72dvh] max-w-[100vw] flex flex-col rounded-t-xl border-t border-borderMuted bg-panel shadow-2xl shadow-black/50 overflow-hidden'
          : 'relative shrink-0 ml-1.5 min-h-0 flex flex-col rounded-md border border-borderSubtle bg-panel overflow-hidden'
      }
      style={sheet ? undefined : { width }}
      aria-label={`${meta.title} · ${ticker}`}
      data-terrain-dock={room}
      data-dock-width={sheet ? 'sheet' : width}
    >
      {!sheet && <div onPointerDown={grip} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 hover:bg-ink/[0.08] active:bg-ink/[0.12] transition-colors" title="Drag to resize" data-dock-grip />}
      {/* THE HEAD — the partner tree's: the glyph in its 24px chip, the room's name, the sub (it gives way first), the
          name it reads, the × with its slow word */}
      <div className="h-10 shrink-0 flex items-center gap-2 px-2.5 border-b border-borderSubtle/70">
        <span className="w-6 h-6 rounded-md border border-borderSubtle bg-ink/[0.03] flex items-center justify-center shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5 text-textSecondary" aria-hidden>
          {meta.icon}
        </span>
        <span className="text-t13 font-semibold text-textPrimary leading-none whitespace-nowrap shrink-0">{meta.title}</span>
        <span className="hidden min-[1600px]:inline flex-1 min-w-0 text-t10 text-textMuted leading-none truncate">{meta.sub}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 shrink-0" data-dock-name>
          <CompanyLogo ticker={ticker} size={14} />
          <span className="font-mono text-t11 font-bold text-textPrimary">{ticker}</span>
        </span>
        <SlowTip label="Close the panel">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the panel"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
            data-dock-close
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </SlowTip>
      </div>
      {/* the phone's sheet carries every room as a tab — its one door to them all */}
      {sheet && (
        <div role="tablist" aria-label="Panels" className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-borderSubtle/60 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-dock-tabs>
          {DOCK_ROOMS.map(r => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === room}
              onClick={() => onRoom(r)}
              className={`shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-t12 font-medium transition-colors [&_svg]:w-3.5 [&_svg]:h-3.5 ${
                r === room ? 'bg-ink/[0.1] text-textPrimary' : 'text-textSecondary hover:text-textPrimary'
              }`}
              data-dock-tab={r}
            >
              {DOCK_META[r].icon}
              {DOCK_META[r].title}
            </button>
          ))}
        </div>
      )}
      {room === 'ladder' && <BookRoom ticker={ticker} view="matrix" />}
      {room === 'heat' && <BookRoom ticker={ticker} view="calendar" />}
      {room === 'surface' && <SurfaceRoom ticker={ticker} mode={mode} paper={paper} />}
      {room === 'regime' && (
        <Board room="regime">
          <RegimeTabs.Regime mode={mode} paper={paper} />
        </Board>
      )}
      {room === 'building' && (
        <Board room="building">
          <RailBuilding ticker={ticker} focus={null} />
        </Board>
      )}
      {room === 'prints' && (
        <Board room="prints">
          <RegimeTabs.Prints ticker={ticker} />
        </Board>
      )}
      {room === 'news' && <NewsRoom ticker={ticker} />}
      {room === 'earnings' && <EarningsRoom names={names} />}
      {room === 'events' && <EventsRoom ticker={ticker} names={names} />}
    </aside>
  );
};

export default DeskDock;
