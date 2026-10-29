/* The Intervals session as one fixed instrument: 09:30 to the close, each quarter hour a bar at its true x, its
   height the volume against the loud bar, the busiest in magenta. A time is always in the same place. */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { WINDOWS_PER_DAY, type IntervalWindow } from '../../data/flowBook';
import { SESSION_LENGTH_MIN } from '../../core/nyTime';
import { earnMarks } from './earnedInk';
import { fmtCount as num } from '../../data/traceLive';

const MIN_PER_SLOT = SESSION_LENGTH_MIN / WINDOWS_PER_DAY;

/* Hour marks at their true x, minutes since the open; the open and the close speak louder — the close is 16:15 for the
   index and ETF options that trade then (the strip takes the name's own slot count) */
const ticksFor = (len: number): { min: number; label: string; edge?: boolean }[] => [
  { min: 0, label: '09:30', edge: true },
  { min: 90, label: '11:00' },
  { min: 210, label: '13:00' },
  { min: 330, label: '15:00' },
  { min: len, label: len === 405 ? '16:15' : '16:00', edge: true },
];

/* Each bar is a soft capsule with a gutter either side, its fill a wash of its ink; the busiest, the open and the
   live ones glow. */
type Fill = { background: string; boxShadow?: string };
const wash = (token: string, foot: number, head: number): string => `linear-gradient(to top, rgb(var(${token}) / ${foot}), rgb(var(${token}) / ${head}))`;
const glow = (token: string, a = 0.35): string => `0 0 10px rgb(var(${token}) / ${a})`;
const QUIET: Fill = { background: wash('--text-secondary', 0.1, 0.38) };
const LOUD: Fill = { background: wash('--text-secondary', 0.32, 0.85) };
const BUSIEST: Fill = { background: wash('--supreme', 0.55, 1), boxShadow: glow('--supreme') };
const OPEN: Fill = { background: wash('--silver', 0.55, 1), boxShadow: glow('--silver', 0.3) };
const LIVE: Fill = { background: wash('--select', 0.45, 1), boxShadow: glow('--select') };
const HELD: Fill = { background: wash('--warn', 0.45, 0.85) };

const DayStrip = ({
  windows,
  selectedIdx,
  onSelect,
  paused,
  slots = WINDOWS_PER_DAY,
}: {
  windows: IntervalWindow[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  paused: boolean;
  /** The session's quarter hours — 26 to 16:00, 27 to 16:15 */
  slots?: number;
}) => {
  const len = slots * MIN_PER_SLOT;
  /** A minute of the session (0 = 09:30) at its x */
  const pct = (minute: number) => `${(minute / len) * 100}%`;
  const TICKS = ticksFor(len);
  const [hover, setHover] = useState<number | null>(null);
  const marks = useMemo(() => earnMarks(windows, w => w.totalVol), [windows]);
  const max = Math.max(marks.top === Infinity ? 1 : marks.top, 1);
  /* The height's ceiling is the loud bar (80th percentile), not the champion, so one burst never flattens the day
     into a barcode. */
  const ceiling = Math.max(marks.bar === Infinity ? max : marks.bar, 1);
  const live = windows.find(w => w.live);
  const nowMin = live ? (live.idx + 1) * MIN_PER_SLOT : null;
  /* A fixed axis mark steps aside when "now" sits within ~52px of it, so the labels never collide on a phone */
  const axisRef = useRef<HTMLDivElement | null>(null);
  const [axisW, setAxisW] = useState(0);
  useEffect(() => {
    const el = axisRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAxisW(el.clientWidth));
    ro.observe(el);
    setAxisW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const berth = axisW > 0 ? Math.max(45, (52 / axisW) * len) : 45;
  const shown = windows[hover ?? selectedIdx] ?? windows[selectedIdx];

  const readout = shown
    ? `${shown.label} ET · ${num(shown.totalVol)} contracts${shown.totalVol >= max && shown.totalVol > 0 ? ' · busiest of the day' : ''}${
        shown.live ? (paused ? ' · held' : ' · still filling') : ''
      }`
    : '';

  const last = windows.length - 1;
  const onKeys = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' ? selectedIdx + 1 : e.key === 'ArrowLeft' ? selectedIdx - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(last, to));
    onSelect(next);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-window="${next}"]`)?.focus();
  };

  return (
    <div className="relative select-none" data-day-strip onPointerLeave={() => setHover(null)}>
      <div className="relative h-12" role="tablist" aria-label="The session's quarter hours, New York" onKeyDown={onKeys}>
        {/* The session as a faint rounded band — no boxed edges; the open and the close are the axis's own marks. */}
        <div aria-hidden className="absolute inset-0 rounded-md bg-ink/[0.03]" />
        {/* The floor the capsules stand on */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-borderMuted/80" />

        {windows.map(w => {
          const sel = w.idx === selectedIdx;
          const champ = w.totalVol >= max && w.totalVol > 0;
          const loud = w.totalVol >= marks.bar;
          const fill: Fill = champ ? BUSIEST : w.live ? (paused ? HELD : LIVE) : sel ? OPEN : loud ? LOUD : QUIET;
          /* linear against the loud bar (see `ceiling`); a floor keeps the quietest window visible. */
          const h = w.totalVol > 0 ? 8 + 92 * Math.min(1, w.totalVol / ceiling) : 0;
          return (
            <button
              key={w.idx}
              type="button"
              role="tab"
              aria-selected={sel}
              tabIndex={sel ? 0 : -1}
              data-window={w.idx}
              data-window-role={w.live ? 'now' : champ ? 'busiest' : sel ? 'open' : undefined}
              aria-label={`${w.label} New York · ${num(w.totalVol)} contracts`}
              onClick={() => onSelect(w.idx)}
              onPointerEnter={() => setHover(w.idx)}
              className="group/slot absolute inset-y-0"
              style={{ left: pct(w.idx * MIN_PER_SLOT), width: pct(MIN_PER_SLOT) }}
            >
              {/* A pill no wider than 16px centred in its slot; the slot stays the click target and the height glides
                 as the live window fills */}
              <span
                className={`absolute bottom-px left-1/2 -translate-x-1/2 w-[clamp(6px,34%,16px)] rounded-t-[8px] rounded-b-[3px] overflow-hidden transition-[height,box-shadow] duration-300 ${w.live && !paused ? 'animate-live-breathe' : ''}`}
                style={{ height: `${h}%`, ...fill }}
              >
                {/* a touch brighter under the pointer, the same shape */}
                <span className="absolute inset-0 bg-ink/0 group-hover/slot:bg-ink/[0.14] transition-colors duration-150" />
              </span>
              {/* where you are: a silver underline on the floor, under the open window's capsule */}
              {sel && <span aria-hidden className="absolute -bottom-px left-1/2 -translate-x-1/2 w-[clamp(10px,50%,24px)] h-[2px] rounded-full bg-silver" />}
            </button>
          );
        })}

        {/* NOW — a hairline at the live window's leading edge. */}
        {nowMin !== null && <div aria-hidden className={`absolute inset-y-0 w-px ${paused ? 'bg-warn/70' : 'bg-select/80'}`} style={{ left: pct(nowMin) }} />}

        {/* The readout, pinned — glass enough to whisper over whatever it covers. On a phone it would cover most of the
            bars (a 352px strip under a 300px readout), so there it stands under the axis instead (below). */}
        {readout && (
          <span
            className={`max-sm:hidden pointer-events-none absolute top-0.5 z-10 px-1.5 py-0.5 rounded border border-borderSubtle bg-panel/70 backdrop-blur-sm font-mono text-t11 tnum whitespace-nowrap text-textSecondary ${
              /* pinned at the end away from the window it reads, so it never sits on that capsule's head */
              shown && shown.idx >= slots * 0.7 ? 'left-0' : 'right-0'
            }`}
            data-strip-readout={shown?.idx}
          >
            <span className={hover !== null && hover !== selectedIdx ? 'text-textPrimary' : 'text-silver'}>{readout}</span>
          </span>
        )}
      </div>

      {/* The axis: every mark at its own x, the open and close brighter, "now" in the status ink. */}
      <div ref={axisRef} className="relative h-4 font-mono text-t11 text-textMuted tnum">
        {TICKS.map(t => {
          // "now" owns its neighbourhood: a fixed mark within a label's width of it steps aside.
          const near = nowMin !== null && Math.abs(t.min - nowMin) < berth;
          if (near) return null;
          return (
            <span
              key={t.min}
              className={`absolute top-0 flex flex-col items-center ${t.edge ? 'text-textSecondary' : ''}`}
              style={{ left: pct(t.min), transform: t.min === 0 ? 'none' : t.min >= SESSION_LENGTH_MIN ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              <span className={`w-px h-1 ${t.edge ? 'bg-ink/30' : 'bg-ink/15'}`} />
              <span className="mt-px leading-none">{t.label}</span>
            </span>
          );
        })}
        {nowMin !== null && (
          <span
            className={`absolute top-0 flex flex-col items-center ${paused ? 'text-warn' : 'text-select'}`}
            style={{ left: pct(nowMin), transform: nowMin > SESSION_LENGTH_MIN - 20 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            data-strip-now
          >
            <span className={`w-px h-1 ${paused ? 'bg-warn/70' : 'bg-select/80'}`} />
            <span className="mt-px leading-none">{paused ? 'held' : 'now'}</span>
          </span>
        )}
      </div>
      {/* ON A phone the readout stands under the axis, a line of its own, never over the bars */}
      {readout && (
        <span className="sm:hidden block mt-1 font-mono text-t11 tnum truncate text-silver" data-strip-readout-phone={shown?.idx}>
          {readout}
        </span>
      )}
      {/* ON A phone, ONE slider: a quarter hour is a sliver 13px wide there */}
      {windows.length > 1 && (
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={selectedIdx}
          onChange={e => onSelect(Number(e.target.value))}
          aria-label="Pick a quarter hour"
          aria-valuetext={windows[selectedIdx]?.label}
          className="sm:hidden w-full h-11 accent-[rgb(var(--silver))]"
          data-strip-slider
        />
      )}
    </div>
  );
};

export default DayStrip;
