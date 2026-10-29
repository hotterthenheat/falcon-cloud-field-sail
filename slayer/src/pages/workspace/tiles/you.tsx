/* The session clock tile: New York's time, the session's phases end to end with where we are, and what the phase
   means for the desk's levels. */

import { useEffect, useState } from 'react';
import { PHASES, type ClockFacts } from '../../../components/gex/TraderClock';
import { aheadClock, CLOSE_MIN, OPEN_MIN } from '../../../data/ahead';
import { readSessionClock } from '../../../data/moc';
import type { TileProps } from '../tile';
import { TileRead } from './parts';

const SPAN = CLOSE_MIN - OPEN_MIN;
const two = (n: number) => String(n).padStart(2, '0');
const leftWords = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${two(min % 60)}m` : `${min}m`);

/* The clock reads New York every second on its own timer; the desk's book does not tick that often */
const useSecond = () => {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
};

export const ClockTile = ({ ctx, size }: TileProps) => {
  useSecond();
  const raw = readSessionClock();
  const clock = aheadClock(raw);
  const now = clock.inSession && clock.nowMin != null ? clock.nowMin : null;
  const phase = now != null ? PHASES.find(p => now >= p.from && now < p.to) ?? PHASES[PHASES.length - 1] : null;
  const next = now != null ? PHASES.find(p => p.from > now) ?? null : null;
  const { pin, supreme, flip } = ctx.exposure.levels;
  const facts: ClockFacts = { pin, supreme, flip, charmStrike: null, charmMoves: null, bellShare: null };
  const wide = size.room !== 'small';
  return (
    <div className="h-full min-h-0 flex flex-col" data-clock-tile={phase?.key ?? 'shut'}>
      <div className="flex-1 min-h-0 flex flex-col justify-center gap-3 px-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-t26 leading-none font-semibold tnum text-textPrimary" data-clock-time>
            {raw.etTime}
          </span>
          <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">New York</span>
          <span className="ml-auto font-mono text-t11 tnum text-textSecondary whitespace-nowrap">{now != null ? `${leftWords(clock.minutesLeft)} to the close` : raw.label}</span>
        </div>
        {/* THE SESSION — its phases end to end, as long as they last; the part behind us washed, now a silver rule */}
        <div>
          <div className="relative flex h-[18px] rounded-[5px] overflow-hidden bg-ink/[0.05]" data-clock-strip>
            {PHASES.map(p => (
              <span key={p.key} className={`relative h-full border-r border-panel last:border-0 ${phase?.key === p.key ? 'bg-silver/[0.28]' : ''}`} style={{ width: `${((p.to - p.from) / SPAN) * 100}%` }} title={`${p.name} · ${two(Math.floor(p.from / 60))}:${two(p.from % 60)}–${two(Math.floor(p.to / 60))}:${two(p.to % 60)}`} data-clock-phase={p.key} />
            ))}
            {now != null && (
              <>
                <span className="absolute inset-y-0 left-0 bg-ink/[0.10] pointer-events-none" style={{ width: `${((now - OPEN_MIN) / SPAN) * 100}%` }} aria-hidden />
                <span className="absolute inset-y-0 w-[2px] bg-silver pointer-events-none" style={{ left: `calc(${((now - OPEN_MIN) / SPAN) * 100}% - 1px)` }} data-clock-now />
              </>
            )}
          </div>
          {/* the hours under it, each where it falls on the strip */}
          <div className="relative mt-1 h-3 font-mono text-t9 tnum text-textMuted">
            <span className="absolute left-0">09:30</span>
            {(wide ? [11 * 60 + 30, 14 * 60] : [14 * 60]).map(m => (
              <span key={m} className="absolute -translate-x-1/2" style={{ left: `${((m - OPEN_MIN) / SPAN) * 100}%` }}>
                {two(Math.floor(m / 60))}:{two(m % 60)}
              </span>
            ))}
            <span className="absolute right-0">16:00</span>
          </div>
        </div>
      </div>
      <TileRead testId="clock">
        {phase ? (
          <>
            <span className="font-semibold text-textPrimary">{phase.name}:</span> {phase.words(facts)}.{next ? ` ${next.name} in ${leftWords(next.from - now!)}.` : ''}
          </>
        ) : (
          <>
            {raw.label}. When it opens: {PHASES[0].words(facts)}.
          </>
        )}
      </TileRead>
    </div>
  );
};
