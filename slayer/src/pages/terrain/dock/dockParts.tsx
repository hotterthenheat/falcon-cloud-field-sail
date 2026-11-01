import type { ReactNode } from 'react';
import { Moon, Sunrise } from 'lucide-react';
import type { ReportSlot } from '../../../data/earnings';
import { nyInstant, regularCloseMin, REGULAR_OPEN_MIN } from '../../../core/session';

/*
==================================================
  SLAYER TERMINAL - THE DOCK'S SHARED GRAMMAR (pages/terrain/dock/dockParts.tsx)

  The Earnings and Events rooms are two lists on one grammar (ported from the partner tree, 2026-10-31): a column head
  line, a day's head that sticks as the list scrolls with the day's facts at its right, small chips for the cuts, a
  countdown that reads "1d 19h", and the Dossier's slot marks (the sunrise before the open, the moon after the close, a
  hollow ring when the time is not set).
==================================================
*/

/** "2d 23h" · "19h 12m" · "7m" · "now" — one countdown everywhere the dock says how far off something is */
export const untilShort = (ms: number): string => {
  if (ms <= 30_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

/** The instant a report is counted out — the regular open before the open, the regular close (13:00 on an early close)
    after it or with no time set — read off the session module, never a bare clock */
export const reportOutAt = (iso: string | undefined, slot: ReportSlot, timeKnown?: boolean): number | null => {
  const d = (iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return nyInstant(d, slot === 'BMO' && timeKnown !== false ? REGULAR_OPEN_MIN : regularCloseMin(d));
};

export interface Col {
  label: string;
  right?: boolean;
}

/** The column head line — the same 9px caps the Dossier's grids use */
export const ColHeads = ({ cols, grid }: { cols: Col[]; grid: string }) => (
  <div className="grid items-center h-7 px-3 gap-x-2 border-b border-borderSubtle/60 font-mono text-t9 font-semibold uppercase tracking-widest text-textMuted select-none" style={{ gridTemplateColumns: grid }} data-dock-cols>
    {cols.map((c, i) => (
      <span key={c.label || i} className={`truncate ${c.right ? 'text-right' : ''}`}>
        {c.label}
      </span>
    ))}
  </div>
);

/** A day's head: sticky, the day in the primary ink, its facts at the right in the figures' mono */
export const DayHead = ({ label, facts, children }: { label: string; facts?: string; children?: ReactNode }) => (
  <div className="sticky top-0 z-10 flex items-center gap-2 h-8 px-3 bg-panel border-b border-borderSubtle/60" data-dock-day={label}>
    <span className="text-t12 font-semibold text-textPrimary whitespace-nowrap">{label}</span>
    {children}
    {facts && <span className="ml-auto font-mono text-t10 tnum text-textMuted truncate">{facts}</span>}
  </div>
);

export const Chip = ({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    title={title}
    className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-t105 font-medium whitespace-nowrap transition-colors ${
      on ? 'bg-ink/[0.08] border-transparent text-textPrimary' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]'
    }`}
  >
    {children}
  </button>
);

export const EmptyLine = ({ children }: { children: ReactNode }) => (
  <p className="px-3.5 py-4 text-t11 leading-snug text-textMuted" data-dock-empty>
    {children}
  </p>
);

/** The Dossier's slot mark: sunrise before the open, moon after the close, a hollow ring when the time is not set */
export const SlotMark = ({ slot, timeKnown, className = 'w-3 h-3' }: { slot: ReportSlot; timeKnown?: boolean; className?: string }) =>
  timeKnown === false ? (
    <span className={`${className} inline-block rounded-full border border-textMuted/60`} aria-label="time not set" />
  ) : slot === 'BMO' ? (
    <Sunrise className={`${className} text-warn`} aria-label="before the open" />
  ) : (
    <Moon className={`${className} text-moon`} aria-label="after the close" />
  );

export const slotWords = (slot: ReportSlot, timeKnown?: boolean): string => (timeKnown === false ? 'time not set' : slot === 'BMO' ? 'before the open' : 'after the close');

/** The room's search field — the house's quiet input */
export const SearchField = ({ value, onChange, placeholder, width = 150 }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number }) => (
  <input
    value={value}
    onChange={e => onChange(e.target.value)}
    onKeyDown={e => {
      if (e.key !== 'Escape') e.stopPropagation();
    }}
    placeholder={placeholder}
    aria-label={placeholder}
    spellCheck={false}
    className="h-6 px-2 rounded-md border border-borderSubtle bg-inset text-t11 text-textPrimary placeholder:text-textMuted outline-none focus:border-borderMuted transition-colors"
    style={{ width }}
    data-dock-search
  />
);
