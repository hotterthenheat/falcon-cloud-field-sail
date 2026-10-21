/*
==================================================
  SLAYER TERMINAL - DAY STRIP (the Intervals page's
  session instrument)

  THE SESSION AS ONE FIXED INSTRUMENT (the partner's
  strip, taken at Noah's word, 2026-10-13): 09:30 to
  16:00 New York, its 26 quarter hours each at its
  true x inside a faint session band on a baseline,
  the future empty above the baseline — so the shape
  never changes through the session and a time is
  always in the same place. It ran midnight to
  midnight on the machine's clock as 96 equal shaded
  blocks until then (2026-09-16, the clock's clothes).

  What a bar says:
    · its HEIGHT is the window's volume against the
      loud bar (the 80th percentile, so the ordinary
      bulk spreads over the height and one burst
      does not flatten the day into a barcode);
    · the volume floor's two registers — the quiet
      bulk faint, the loud quintile bright — and the
      day's busiest window in the SUPREME magenta:
      a magnitude wears one ink, and the ink crowns
      it, not the height;
    · the window you have open stands on a silver
      column (where you are); the live one breathes
      the status ink under a "now" hairline, held =
      amber;
    · a readout pinned top right reads the window
      under the pointer, or the one open;
    · the keys: ← → walk the windows, Home and End
      the first and the last; on a phone a slider
      under the strip, a finger's width tall.
==================================================
*/

import { useMemo, useState, type KeyboardEvent } from 'react';
import { WINDOWS_PER_DAY, type IntervalWindow } from '../../data/flowBook';
import { SESSION_LENGTH_MIN } from '../../core/nyTime';
import { earnMarks } from './earnedInk';

const SLOTS = WINDOWS_PER_DAY;
const MIN_PER_SLOT = SESSION_LENGTH_MIN / SLOTS;
const num = (v: number) => v.toLocaleString('en-US');
/** A minute of the SESSION (0 = 09:30) at its x */
const pct = (minute: number) => `${(minute / SESSION_LENGTH_MIN) * 100}%`;

/* Hour marks at their true x, minutes since the open; the open and the close speak louder. */
const TICKS: { min: number; label: string; edge?: boolean }[] = [
  { min: 0, label: '09:30', edge: true },
  { min: 90, label: '11:00' },
  { min: 210, label: '13:00' },
  { min: 330, label: '15:00' },
  { min: 390, label: '16:00', edge: true },
];

/* THE BARS ARE CAPSULES, NOT BLOCKS (Noah, 2026-10-13: "they look way too blocky like barebone html"): each bar is a
   soft capsule in its slot with a gutter either side, its fill a vertical wash of its ink — the foot faint, the head full —
   and the three that mean something (the busiest, the one open, the live one) carry a glow in their own ink. The
   volume floor's two registers are the secondary ink at two strengths, a token on either ground. */
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
}: {
  windows: IntervalWindow[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  paused: boolean;
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const marks = useMemo(() => earnMarks(windows, w => w.totalVol), [windows]);
  const max = Math.max(marks.top === Infinity ? 1 : marks.top, 1);
  /* The height's ceiling is the LOUD bar (the 80th percentile), not the champion: measured on a live day, one 160k
     burst over a 60–80k bulk put every ordinary window in the bottom third and the strip read as a flat barcode.
     Against the loud bar the bulk spreads over the height, the loud quintile touches the ceiling, and the champion
     is told by its magenta. */
  const ceiling = Math.max(marks.bar === Infinity ? max : marks.bar, 1);
  const live = windows.find(w => w.live);
  const nowMin = live ? (live.idx + 1) * MIN_PER_SLOT : null;
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
          /* LINEAR against the loud bar (see `ceiling`); a floor keeps the quietest window visible. */
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
              {/* THE CAPSULE IS SLIM (Noah, 2026-10-13: "its too wide"): a pill no wider than 16px centred in its slot, air
                  either side — the slot stays the click target; its height glides as the live window fills */}
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
            className={`max-sm:hidden pointer-events-none absolute top-0.5 z-10 px-1.5 py-0.5 rounded border border-borderSubtle bg-panel/70 backdrop-blur-sm font-mono text-[11px] tnum whitespace-nowrap text-textSecondary ${
              /* pinned at the end AWAY from the window it reads, so it never sits on that capsule's head */
              shown && shown.idx >= SLOTS * 0.7 ? 'left-0' : 'right-0'
            }`}
            data-strip-readout={shown?.idx}
          >
            <span className={hover !== null && hover !== selectedIdx ? 'text-textPrimary' : 'text-silver'}>{readout}</span>
          </span>
        )}
      </div>

      {/* The axis: every mark at its own x, the open and close brighter, "now" in the status ink. */}
      <div className="relative h-4 font-mono text-[11px] text-textMuted tnum">
        {TICKS.map(t => {
          // "now" owns its neighbourhood: a fixed mark within a label's width of it steps aside.
          const near = nowMin !== null && Math.abs(t.min - nowMin) < 45;
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
      {/* ON A PHONE the readout stands under the axis, a line of its own, never over the bars */}
      {readout && (
        <span className="sm:hidden block mt-1 font-mono text-[11px] tnum truncate text-silver" data-strip-readout-phone={shown?.idx}>
          {readout}
        </span>
      )}
      {/* ON A PHONE, ONE SLIDER: a quarter hour is a sliver 13px wide there */}
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
