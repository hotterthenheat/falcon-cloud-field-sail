import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { CalendarCheck, CalendarDays, X } from 'lucide-react';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { setDockWidth, useDockWidth, type DockRoom } from './dockStore';
import EarningsRoom from './dock/EarningsRoom';
import EventsRoom from './dock/EventsRoom';

/*
==================================================
  SLAYER TERMINAL - THE DESK'S DOCK (pages/terrain/DeskDock.tsx)

  The column at the desk's right edge (ported from the partner tree, 2026-10-31), one room at a time — Earnings and
  Events, the two calendars the desk had no way to see (the strike rail already carries Building, Prints, Regime and
  Surface; the dock does not repeat them). In the desk's row, so the charts give way beside it and nothing covers a
  tape; shut by rest (dockStore.ts) and narrow (380, the grip on its left edge widens it). On a phone it is a sheet
  over the foot of the page, the screen's own width. Never over a fullscreen pane.
==================================================
*/

const ROOMS: Record<DockRoom, { title: string; sub: string; icon: ReactNode }> = {
  earnings: { title: 'Earnings', sub: "the week's reports", icon: <CalendarCheck /> },
  events: { title: 'Events', sub: 'what lands when', icon: <CalendarDays /> },
};

interface Props {
  room: DockRoom;
  ticker: string;
  /** every name on the desk's panes — the calendars' "This desk" scope */
  names: string[];
  onClose: () => void;
  onRoom: (room: DockRoom) => void;
  /** the phone's sheet instead of the desk's column */
  sheet?: boolean;
}

const DeskDock = ({ room, ticker, names, onClose, onRoom, sheet = false }: Props) => {
  const meta = ROOMS[room];
  const width = useDockWidth();
  const grip = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDockWidth(startW + (startX - ev.clientX));
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
      <div className="h-10 shrink-0 flex items-center gap-2 px-2.5 border-b border-borderSubtle/70">
        {/* the two rooms as tabs in the head — one press between the calendars */}
        <div role="tablist" aria-label="Dock rooms" className="inline-flex items-center gap-0.5 rounded-md bg-ink/[0.04] p-0.5">
          {(Object.keys(ROOMS) as DockRoom[]).map(r => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === room}
              onClick={() => onRoom(r)}
              className={`inline-flex items-center gap-1.5 h-6 px-2 rounded text-t12 font-semibold transition-colors [&_svg]:w-3.5 [&_svg]:h-3.5 ${
                r === room ? 'bg-ink/[0.1] text-textPrimary' : 'text-textSecondary hover:text-textPrimary'
              }`}
              data-dock-tab={r}
            >
              {ROOMS[r].icon}
              {ROOMS[r].title}
            </button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 shrink-0 min-w-0" data-dock-name title={`${meta.sub} — the active chart's name`}>
          <CompanyLogo ticker={ticker} size={14} />
          <span className="font-mono text-t11 font-bold text-textPrimary">{ticker}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the dock"
          title="Close the dock"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
          data-dock-close
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {room === 'earnings' && <EarningsRoom names={names} />}
      {room === 'events' && <EventsRoom ticker={ticker} names={names} />}
    </aside>
  );
};

export default DeskDock;
