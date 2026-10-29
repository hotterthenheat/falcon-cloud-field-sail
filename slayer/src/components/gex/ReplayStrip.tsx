/* The replay bar: pick (a click on a bar starts there) then play, as a card floating over the foot of the plot.
   Two rows: the scrubber, then pace, transport and "Back to live"; silver, never live ink. `compact` is one line for a box's head. */

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, X } from 'lucide-react';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { OPEN_MIN, hhmm } from '../../data/ahead';

const SILVER = 'rgb(var(--silver))';
const SILVER_FILL = 'rgb(var(--silver-fill))'; /* the silver as a SURFACE — the dark glyph sits on it, on either ground */
/* The pace as a multiple (1×, 2×, 4×) with the candles it moves beside it: 1× is a tape minute a second.
   A host gives its candle length (`candleMin`); a bar-driven chart says `paceUnit="bars"`. */
/** A session clock's paces: session seconds a real second. 1× = a minute of the tape a second. */
const CLOCK_PACES: { value: number; label: string }[] = [
  { value: 1, label: 'Real time' },
  { value: 30, label: '½×' },
  { value: 60, label: '1×' },
  { value: 120, label: '2×' },
  { value: 240, label: '4×' },
  { value: 600, label: '10×' },
];
/** A chart's own replay: bars a real second */
const BAR_PACES: { value: number; label: string }[] = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 5, label: '5×' },
  { value: 10, label: '10×' },
];
const COUNT = ['', 'A', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const num = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
/** How fast the tape moves, in candles: the few words beside the card, and the sentence on a row of its menu */
function candlePace(perSecond: number): { short: string; long: string } {
  if (perSecond >= 1) {
    const n = Math.round(perSecond);
    const whole = Math.abs(perSecond - n) < 0.05;
    return { short: `${num(perSecond)} ${whole && n === 1 ? 'candle' : 'candles'} / sec`, long: whole && n <= 10 ? `${COUNT[n]} ${n === 1 ? 'candle' : 'candles'} a second` : `${num(perSecond)} candles a second` };
  }
  const secs = 1 / perSecond;
  if (secs < 59.5) return { short: `1 candle / ${num(secs)} sec`, long: `A candle every ${num(secs)} seconds` };
  const mins = secs / 60;
  return Math.abs(mins - 1) < 0.05 ? { short: '1 candle / min', long: 'A candle a minute' } : { short: `1 candle / ${num(mins)} min`, long: `A candle every ${num(mins)} minutes` };
}
/** Under this the card sheds its two jump buttons, the marks' words and the door's words (a pane of a four-up desk) */
const NARROW_W = 520;

interface Props {
  phase: 'pick' | 'play';
  /** Seconds from the open */
  pos: number;
  /** Seconds the session covers */
  length: number;
  /** The day the session is — "Sep 4" */
  day?: string;
  /** New York's minute at the session's first bar — the open (09:30) unless given (data/replay.ts replayStart) */
  startMin?: number;
  playing: boolean;
  onPlay: (playing: boolean) => void;
  pace: number;
  onPace: (pace: number) => void;
  onSeek: (pos: number) => void;
  onExit: () => void;
  /** One short line for a box's head: the transport and the position, no pace */
  compact?: boolean;
  /** The moment's own words, when the position is not session seconds (a chart replaying by bars) */
  words?: string;
  /** The marks along the track, 0..1 — where an hour or a day turns; the session's hours unless a host hands its own */
  marks?: { u: number; label: string }[];
  /** Sections of the day along the track, 0..1 — premarket, regular, after hours, overnight */
  sections?: { u0: number; u1: number; label: string }[];
  /** What a pace counts: 'seconds' (a session clock — session seconds a real second, the default) or 'bars' (a chart playing
      its own bars — bars a second) */
  paceUnit?: 'seconds' | 'bars';
  /** Minutes in a candle of the chart this bar drives (a session clock's words are said in THOSE candles); 1 unless given */
  candleMin?: number;
  /** One step of the transport, in the position's own units — a bar for a chart (1), a minute for a session (60) */
  step?: number;
  /** Where the position stands among its kind — "124 / 367" */
  counter?: string;
  /** The words for a place on the track — the tag that rides the pointer over it */
  wordsAt?: (pos: number) => string;
  /** Where the way out goes, when it is not the live screen (Review's desk: back to its sessions) */
  exitWords?: string;
  /** The word after the moment — "replaying" unless the host says otherwise */
  stateWord?: string;
  /** The floor the position cannot go behind (a backtest's clock only moves forward); the back doors shut there and say why in `minTitle`. */
  minPos?: number;
  minTitle?: string;
  className?: string;
  /** The compact line as a bar of its own across a box: the track takes the room, the moment under the pointer beside it. */
  wide?: boolean;
}

const iconBtn = 'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-textSecondary transition-colors';
const doorBtn = 'shrink-0 inline-flex items-center gap-1.5 h-6 rounded-md border border-borderSubtle hover:border-borderMuted font-mono text-t11 text-textSecondary hover:text-textPrimary transition-colors';

const ReplayStrip = ({ phase, pos, length, day, startMin, playing, onPlay, pace, onPace, onSeek, onExit, compact = false, words, marks, sections, paceUnit = 'seconds', candleMin = 1, step = 60, counter, wordsAt, exitWords = 'Back to live', stateWord = 'replaying', minPos = 0, minTitle, className = '', wide = false }: Props) => {
  /* candles a real second at a pace: a chart's own bars ARE candles; a session clock's seconds are folded into the host's candle */
  const perSecond = (p: number) => (paceUnit === 'bars' ? p : p / (60 * Math.max(1 / 60, candleMin)));
  const paceOptions: DropdownOption<number>[] = (paceUnit === 'bars' ? BAR_PACES : CLOCK_PACES).map(o => ({ ...o, hint: o.value === 1 && paceUnit === 'seconds' ? `As it happened — ${candlePace(perSecond(1)).long.toLowerCase()}` : candlePace(perSecond(o.value)).long }));
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  /** The pointer over the track, 0..1 — the tag that says the moment under it */
  const [over, setOver] = useState<number | null>(null);
  const [folded, setFolded] = useState(false);
  const uAt = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const u = uAt(e.clientX);
    if (u != null) onSeek(u * length);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const u = uAt(e.clientX);
    if (u == null) return;
    setOver(u);
    if (dragging.current) onSeek(u * length);
  };
  const onUp = () => {
    dragging.current = false;
  };

  /* The card knows its room: a four-up pane is ~480 px wide and the full second row ~520. */
  const roomRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const read = () => setNarrow(el.clientWidth < NARROW_W);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase, folded]);

  const played = length > 0 ? Math.max(0, Math.min(100, (pos / length) * 100)) : 0;
  /* The hours beneath the track — every hour the session covers, on the same scale */
  const spanMin = Math.max(1, length / 60);
  const hours: number[] = [];
  const start = startMin ?? OPEN_MIN;
  const end = start + spanMin;
  const fold = (m: number) => ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  for (let m = Math.ceil(start / 60) * 60; m <= end + 0.01; m += 60) hours.push(m);
  const ticks = marks ?? hours.map(m => ({ u: Math.max(0, Math.min(1, (m - start) / spanMin)), label: hhmm(fold(m)) }));
  const at = (p: number) => hhmm(fold(start + Math.floor(p / 60)));
  const sectionNow = (p: number) => {
    if (!sections?.length || length <= 0) return null;
    const u = p / length;
    return sections.find(s => u >= s.u0 - 0.0001 && u <= s.u1 + 0.0001) ?? sections[sections.length - 1];
  };
  const sayAt = wordsAt ?? ((p: number) => {
    const name = sectionNow(p)?.label;
    return name ? `${at(p)} · ${name}` : at(p);
  });
  const sayAtLater = sayAt;
  /* the moment under the pointer, said where the moment is said (a bar across a box has no room above its track) */
  const when = words ?? `${day ? `${day} · ` : ''}${wide && over != null ? sayAtLater(over * length) : at(pos)}`;

  /* A step is taken with the tape held: stepping under a running replay is a fight for the position */
  const stepTo = (next: number) => {
    if (playing) onPlay(false);
    onSeek(Math.max(0, Math.min(length, next)));
  };
  const atStart = pos <= minPos;
  /* a door shut at the floor says why; at the session's own start it needs no words */
  const backTitle = (own: string) => (atStart && minPos > 0 && minTitle ? minTitle : own);
  const atEnd = pos >= length;

  /* ---- the pieces ---- */
  const track = (w: string, withMarks: boolean) => (
    <div
      className={`relative ${w} ${sections?.length ? 'h-10' : withMarks ? 'h-7' : 'h-6'} flex items-center cursor-pointer touch-none`}
      ref={trackRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setOver(null)}
      /* Keyboard: a slider, arrows a step, Shift ten, Home and End the ends. */
      tabIndex={0}
      role="slider"
      aria-label="The replay's position"
      aria-valuemin={0}
      aria-valuemax={length}
      aria-valuenow={Math.round(pos)}
      aria-valuetext={at(pos)}
      onKeyDown={e => {
        const by = e.shiftKey ? step * 10 : step;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') stepTo(pos - by);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') stepTo(pos + by);
        else if (e.key === 'Home') stepTo(0);
        else if (e.key === 'End') stepTo(length);
        else return;
        e.preventDefault();
      }}
      data-replay-track
    >
      <div className={`relative w-full h-[3px] rounded-full bg-ink/[0.12] ${sections?.length ? 'mt-3' : withMarks ? '-translate-y-[5px]' : ''}`}>
        {sections?.map(s => (
          <span key={`s-${s.label}-${s.u0}`} className="absolute bottom-full mb-1 h-3 overflow-hidden border-l border-ink/30 pl-1 font-mono text-t8 uppercase tracking-wider text-textMuted leading-3 pointer-events-none" style={{ left: `${s.u0 * 100}%`, width: `${Math.max(4, (s.u1 - s.u0) * 100)}%` }} data-replay-section={s.label}>
            {s.label}
          </span>
        ))}
        {/* the marks ON the track — where an hour (or a day) turns */}
        {ticks.map(t => (
          <span key={`n-${t.u}-${t.label}`} className="absolute top-1/2 -translate-y-1/2 w-px h-[7px] bg-ink/[0.22]" style={{ left: `${t.u * 100}%` }} aria-hidden="true" />
        ))}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${played}%`, background: SILVER }} data-replay-played />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[11px] h-[11px] rounded-full ring-2 ring-panel shadow-[0_0_0_3px_rgb(var(--silver)/0.18)]" style={{ left: `${played}%`, background: SILVER }} data-replay-handle />
      </div>
      {withMarks &&
        ticks.map(t => (
          <span key={`${t.u}-${t.label}`} className="absolute bottom-0 -translate-x-1/2 font-mono text-t11 leading-none text-textMuted tnum whitespace-nowrap pointer-events-none" style={{ left: `${t.u * 100}%` }}>
            {t.label}
          </span>
        ))}
      {/* the moment under the pointer — on the card only: in a box's head there is no room above the line (the head clips
          it), and the moment beside the track already follows a drag */}
      {over != null && withMarks !== undefined && !compact && (
        <span
          className="absolute bottom-full mb-0.5 -translate-x-1/2 px-1.5 py-0.5 rounded border border-borderMuted bg-card font-mono text-t11 tnum text-textPrimary whitespace-nowrap pointer-events-none shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
          style={{ left: `${over * 100}%` }}
          data-replay-over
        >
          {sayAt(over * length)}
        </span>
      )}
    </div>
  );
  const playButton = (size: 'md' | 'sm') => (
    <button
      type="button"
      onClick={() => onPlay(!playing)}
      title={playing ? 'Pause' : 'Play'}
      aria-pressed={playing}
      /* running = silver, the house's "on"; held = an outlined ring */
      className={`shrink-0 inline-flex items-center justify-center rounded-full border transition-colors ${size === 'md' ? 'w-8 h-8' : 'w-6 h-6'} ${playing ? 'border-transparent text-onfoil' : 'border-borderMuted text-textPrimary hover:border-textSecondary hover:bg-ink/[0.05]'}`}
      style={playing ? { background: SILVER_FILL } : undefined}
      data-replay-play
    >
      {playing ? <Pause className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} /> : <Play className={`${size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} translate-x-[1px]`} />}
    </button>
  );
  const stepBack = (
    <button type="button" onClick={() => stepTo(pos - step)} disabled={atStart} title={backTitle('One step back')} aria-label="One step back" className={iconBtn} data-replay-step="back">
      <StepBack className="w-3.5 h-3.5" />
    </button>
  );
  const stepOn = (
    <button type="button" onClick={() => stepTo(pos + step)} disabled={atEnd} title="One step on" aria-label="One step on" className={iconBtn} data-replay-step="on">
      <StepForward className="w-3.5 h-3.5" />
    </button>
  );
  /* in a narrow pane the moment sheds its "replaying" — the pane's own identity row already wears the REPLAY badge, and
     the first row has to hold the track, the count and the fold as well (measured: the fold stood outside a 386px card) */
  const moment = (
    <span className="shrink-0 font-mono text-t11 font-semibold tnum whitespace-nowrap" style={{ color: SILVER }} data-replay-time>
      {when}
      {!(narrow && !compact) && <span className="text-t11 font-normal uppercase tracking-widest"> · {stateWord}</span>}
    </span>
  );
  const exitDoor = (wordsToo: boolean) => (
    <button type="button" onClick={onExit} title={exitWords === 'Back to live' ? 'Back to live (Esc)' : exitWords} aria-label={exitWords} className={`${doorBtn} ${wordsToo ? 'px-2.5' : 'w-6 justify-center'}`} data-replay-exit>
      {wordsToo ? exitWords : <X className="w-3 h-3" />}
    </button>
  );

  /* ---- ONE LINE, for a box's head ---- */
  if (compact) {
    if (phase === 'pick')
      return (
        <span className="inline-flex items-center gap-2 h-7 font-mono text-t11" style={{ color: SILVER }} data-replay-strip="pick">
          <Crosshair className="w-3 h-3" aria-hidden="true" /> Select a bar on the chart
        </span>
      );
    if (wide)
      return (
        <div className={`flex items-center gap-1.5 ${sections?.length ? 'h-11' : 'h-9'} px-2 min-w-0 ${className}`} data-replay-strip="wide">
          {stepBack}
          {playButton('sm')}
          {stepOn}
          {track('flex-1 min-w-[120px]', false)}
          <span className="shrink-0 font-mono text-t11 font-semibold tnum whitespace-nowrap" style={{ color: SILVER }} data-replay-time title={`${when} · ${stateWord}`}>
            {sayAt(pos)}
          </span>
          {/* The pace on the bar too: in fullscreen there is no card. */}
          <DropdownSelect label="Pace" value={pace} options={paceOptions} onChange={onPace} title="How fast it plays back" testId="replay-pace" size="sm" flat />
          {exitDoor(false)}
        </div>
      );
    return (
      <span className="inline-flex items-center gap-1.5 h-7" data-replay-strip="compact">
        {stepBack}
        {playButton('sm')}
        {stepOn}
        <span className="w-1" aria-hidden="true" />
        {track('w-[180px]', false)}
        <span className="w-1" aria-hidden="true" />
        {moment}
        {exitDoor(false)}
      </span>
    );
  }

  /* ---- THE CARD, floating over the foot of a plot ---- */
  const shell = (body: ReactNode, state: string) => (
    <div ref={roomRef} className={`w-full flex justify-center pointer-events-none select-none ${className}`}>
      <div
        /* 600 px: the least that holds the pace card, the five transport buttons centred and the way out on one line. */
        className={`pointer-events-auto ${state === 'folded' ? '' : 'w-full max-w-[600px]'} rounded-xl border border-borderMuted bg-panel shadow-[0_14px_40px_rgba(0,0,0,0.5)] animate-soft-in`}
        data-chart-chrome
        data-replay-strip={state}
      >
        {body}
      </div>
    </div>
  );

  if (phase === 'pick')
    return shell(
      <div className="flex items-center gap-2.5 h-10 pl-3.5 pr-2">
        <Crosshair className="w-3.5 h-3.5 shrink-0" style={{ color: SILVER }} aria-hidden="true" />
        <span className="min-w-0 truncate font-mono text-t11" style={{ color: SILVER }}>
          Select a bar on the chart <span className="text-t11 uppercase tracking-widest">· the replay starts there</span>
        </span>
        <span className="ml-auto">{exitDoor(true)}</span>
      </div>,
      'pick'
    );

  if (folded)
    return shell(
      <div className="flex items-center gap-2 h-10 pl-1.5 pr-1.5">
        {playButton('sm')}
        {moment}
        {counter && <span className="font-mono text-t11 tnum text-textMuted whitespace-nowrap">{counter}</span>}
        <button type="button" onClick={() => setFolded(false)} title="Open the replay bar" aria-label="Open the replay bar" className={iconBtn} data-replay-fold="open">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        {exitDoor(false)}
      </div>,
      'folded'
    );

  return shell(
    <>
      {/* THE SCRUBBER — the moment, the track, the count */}
      <div className="flex items-center gap-3 pl-3.5 pr-1.5 pt-1.5">
        {moment}
        {track(narrow ? 'flex-1 min-w-[72px]' : 'flex-1 min-w-[120px]', !narrow)}
        {counter && (
          <span className="shrink-0 font-mono text-t11 tnum text-textMuted whitespace-nowrap" data-replay-counter>
            {counter}
          </span>
        )}
        <button type="button" onClick={() => setFolded(true)} title="Fold the bar away — the plot under it" aria-label="Fold the replay bar away" className={iconBtn} data-replay-fold="fold">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* THE CONTROLS — the pace, the transport in the middle, the way out */}
      {/* minmax(0,1fr): the two sides are EQUAL whatever they hold, so the transport is in the card's true middle — in a
          narrow pane the pace card gives (its value truncates) before the middle moves */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 pl-2.5 pr-2 pb-2 pt-0.5">
        <span className="min-w-0 flex items-center [&>button]:min-w-0 [&>button]:max-w-full">
          <DropdownSelect label="Pace" value={pace} options={paceOptions} onChange={onPace} title="How fast it plays back" testId="replay-pace" size="sm" />
          {/* the few words: what that multiple moves, in this chart's candles — they give before the card does */}
          {!narrow && (
            <span className="ml-2 min-w-0 truncate font-mono text-t11 tnum text-textMuted whitespace-nowrap" title={candlePace(perSecond(pace)).long} data-replay-pace-words>
              {candlePace(perSecond(pace)).short}
            </span>
          )}
        </span>
        <span className="flex items-center gap-0.5" data-replay-transport>
          {!narrow && (
            <button type="button" onClick={() => stepTo(minPos)} disabled={atStart} title={backTitle('To the start')} aria-label="To the start" className={iconBtn} data-replay-jump="start">
              <SkipBack className="w-3.5 h-3.5" />
            </button>
          )}
          {stepBack}
          <span className="px-1">{playButton('md')}</span>
          {stepOn}
          {!narrow && (
            <button type="button" onClick={() => stepTo(length)} disabled={atEnd} title="To the end" aria-label="To the end" className={iconBtn} data-replay-jump="end">
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
        <span className="flex justify-end">{exitDoor(!narrow)}</span>
      </div>
    </>,
    'play'
  );
};

export default ReplayStrip;
