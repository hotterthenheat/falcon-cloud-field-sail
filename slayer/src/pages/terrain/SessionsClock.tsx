import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import Fact from '../../components/ui/Fact';
import { SignatureDot } from '../../brand/Signature';
import { nyClock } from '../../core/nyTime';
import { futuresPhaseAt, FUTURES_PHASE_WORDS } from '../../core/calendar';
import { LANE_WORDS, aheadNotes, dayWindows, inWords, isoDayLabel, minuteClock, nextTurn, nyDayBounds, readLanes } from './sessionsClock';

/*
==================================================
  SLAYER TERMINAL - THE SESSIONS CLOCK (pages/terrain/SessionsClock.tsx)

  On the desk bar (ported from the partner tree's foot clock, 2026-10-31), on OUR session: the chip prints New York's
  clock with the signature's dot for the tape (live while any session trades) and the next turn — "Regular closes in
  1h 12m"; a press opens a card that is ONE NEW YORK DAY AS A RULER, midnight to midnight, a lane a session (overnight,
  pre-market, regular, after hours — the windows src/core/session.ts answers, so a holiday's lanes are empty and an
  early close's regular lane stops at 13:00), the moment now a silver line down all four; under it the dot-leader rows
  (ui/Fact) — "closes in" in the silver while open, "opens in" while shut — the futures week's phase (core/calendar.ts,
  the read-out the bar used to carry on its own), and the next closures on the calendar. Open wears the silver
  (where-you-are, never a direction); shut is the muted ink.
==================================================
*/

const CARD_W = 332;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const FUTURES_SHORT: Record<ReturnType<typeof futuresPhaseAt>, string> = {
  GLOBEX_ASIA: 'Asia hours',
  GLOBEX_EUROPE: 'Europe hours',
  RTH: 'cash session',
  GLOBEX_POST: 'after the close',
  MAINTENANCE: 'daily break',
  CLOSED: 'closed',
};

const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
};

const DayRuler = ({ now }: { now: number }) => {
  const day = nyDayBounds(now);
  const spans = dayWindows(now);
  const frac = (t: number) => (Math.min(Math.max(t, day.from), day.to) - day.from) / (day.to - day.from);
  const pct = (t: number) => `${frac(t) * 100}%`;
  return (
    <div className="px-3 pt-1 pb-2" data-sessions-ruler>
      <div className="relative ml-8 h-3 font-mono text-t9 leading-3 text-textMuted tnum">
        {HOURS.map(h => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      <div className="relative mt-1 flex flex-col gap-[6px]">
        {(['overnight', 'pre', 'regular', 'post'] as const).map(kind => {
          const mine = spans.filter(s => s.kind === kind);
          const live = mine.some(s => s.from <= now && now < s.to);
          return (
            <div key={kind} className="flex items-center" data-sessions-lane={kind} data-spans={mine.length}>
              <span className={`w-8 shrink-0 font-mono text-t9 leading-none uppercase tracking-[0.04em] ${live ? 'text-silver' : 'text-textMuted'}`}>{LANE_WORDS[kind].short}</span>
              <div className="relative flex-1 h-[6px] rounded-full bg-ink/[0.06]">
                {mine.map((sp, i) => (
                  <span
                    key={i}
                    className={`absolute inset-y-0 rounded-full ${sp.from <= now && now < sp.to ? 'bg-silver' : 'bg-ink/[0.22]'}`}
                    style={{ left: pct(sp.from), width: `calc(${pct(sp.to)} - ${pct(sp.from)})` }}
                    title={`${LANE_WORDS[kind].name} ${nyClock(sp.from)}–${nyClock(sp.to)} ET`}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <span className="absolute -top-[3px] -bottom-[3px] w-px bg-silver" style={{ left: `calc(2rem + (100% - 2rem) * ${frac(now)})` }} aria-hidden data-sessions-now />
      </div>
    </div>
  );
};

const SessionsClock = ({ compact = false }: { compact?: boolean }) => {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(open, 'top', CARD_W, 'end');
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, anchorRef, menuRef]);

  const turn = nextTurn(now);
  const trading = !!turn && turn.phase !== 'closed';
  /* in a window: that session closes at its end; shut: the next session opens */
  const inLane = !!turn && turn.phase !== 'closed' && turn.phase in LANE_WORDS;
  const turnWords = !turn
    ? ''
    : inLane
      ? `${LANE_WORDS[turn.phase as keyof typeof LANE_WORDS].name.toLowerCase()} closes ${inWords(turn.at - now)}`
      : turn.next !== 'closed'
        ? `${LANE_WORDS[turn.next].name.toLowerCase()} opens ${inWords(turn.at - now)}`
        : '';
  const phaseWord = turn && inLane ? LANE_WORDS[turn.phase as keyof typeof LANE_WORDS].name : 'Closed';
  const lanes = open ? readLanes(now) : [];
  const fut = futuresPhaseAt(new Date(now));
  const notes = open ? aheadNotes(now) : [];
  const day = nyDayBounds(now);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Market sessions — New York ${nyClock(now, { seconds: true })}, ${phaseWord}${turnWords ? `, ${turnWords}` : ''}`}
        className={`pointer-events-auto inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-ink/[0.08] bg-canvas/40 backdrop-blur-[3px] font-mono text-t10 transition-colors ${
          open ? 'text-textPrimary bg-ink/[0.16]' : 'text-textSecondary hover:text-textPrimary'
        }`}
        data-sessions-clock={turn?.phase ?? 'closed'}
      >
        <SignatureDot state={trading ? 'live' : 'closed'} className="w-[7px] h-[7px]" />
        <span className="inline-flex items-baseline gap-1.5">
          <span className="uppercase tracking-wider">NY</span>
          <span className="text-t11 font-semibold tnum text-textPrimary" data-sessions-time>
            {nyClock(now, { seconds: true })}
          </span>
        </span>
        {!compact && (
          <span className="hidden min-[1500px]:inline uppercase tracking-wider text-textMuted whitespace-nowrap" data-sessions-next>
            {turnWords || phaseWord}
          </span>
        )}
      </button>
      {open &&
        placed &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Market sessions"
            className="z-[120] rounded-md border border-borderMuted bg-panel/95 backdrop-blur-md shadow-xl shadow-black/50 overflow-hidden animate-fade-in"
            style={{ position: 'fixed', ...placed.box, width: CARD_W }}
            data-sessions-card
          >
            <div className="flex items-baseline justify-between px-3 pt-2 pb-1">
              <span className="font-mono text-t10 font-bold uppercase tracking-[0.08em] text-textMuted">Market sessions</span>
              <span className="font-mono text-t10 tnum text-textMuted">{isoDayLabel(day.iso)}</span>
            </div>
            <DayRuler now={now} />
            <div className="flex flex-col gap-[7px] px-3 pb-2.5" data-sessions-rows>
              {lanes.map(l => (
                <div key={l.kind} data-sessions-row={l.kind} data-open={l.open ? '' : undefined}>
                  <Fact
                    label={LANE_WORDS[l.kind].name}
                    value={l.changeAt == null ? 'not in the next three weeks' : `${l.open ? 'closes' : 'opens'} ${inWords(l.changeAt - now)}`}
                    valueCls={l.open ? 'text-silver' : 'text-textPrimary'}
                  />
                </div>
              ))}
              <div data-sessions-row="futures" title={`Futures session (Globex): ${FUTURES_PHASE_WORDS[fut].blurb}. A read-out — Terrain charts the cash market.`}>
                <Fact label="Futures" value={FUTURES_SHORT[fut]} valueCls={fut === 'CLOSED' || fut === 'MAINTENANCE' ? 'text-textSecondary' : 'text-silver'} />
              </div>
            </div>
            <p className="px-3 pb-2.5 font-mono text-t10 leading-4 text-textMuted tnum" data-sessions-foot>
              {notes.length
                ? notes.map(n => (n.kind === 'holiday' ? `${isoDayLabel(n.iso)} closed` : `${isoDayLabel(n.iso)} closes ${minuteClock(n.closeMin ?? 0)}`)).join(' · ')
                : 'No closure on the calendar in the next six weeks'}
              {' · '}every clock New York&apos;s
            </p>
          </div>,
          document.body
        )}
    </>
  );
};

export default SessionsClock;
