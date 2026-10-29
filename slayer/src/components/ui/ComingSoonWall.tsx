/* A coming-soon wall over a page (it reads through the glass): lamp, wordmark, countdown, notify field. The host wraps its body
   in a `relative` box and renders this after it; `useWalled` reads `?wall` / `?open` from the URL. */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

/** The day the walled pages open — a placeholder until launch is dated (a Monday's open, New York) */
const OPENS_AT = Date.UTC(2026, 10, 2, 14, 30);
const NOTIFY_KEY = 'slayer_room_notify';

/** The time left to the day, in four figures — zeros once it has come */
const partsTo = (at: number, now: number): [number, string][] => {
  const left = Math.max(0, at - now);
  const s = Math.floor(left / 1000);
  return [
    [Math.floor(s / 86400), 'days'],
    [Math.floor((s % 86400) / 3600), 'hours'],
    [Math.floor((s % 3600) / 60), 'minutes'],
    [s % 60, 'seconds'],
  ];
};

/** Is the wall up? `?wall` forces it up, `?open` forces it down, else the page's rest state */
export function useWalled(defaultUp: boolean): boolean {
  const location = useLocation();
  return useMemo(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('wall')) return true;
    if (q.has('open')) return false;
    return defaultUp;
  }, [location.search, defaultUp]);
}

interface Props {
  /** The small word over the wordmark — the page's name */
  kicker: string;
  /** One paragraph under "Coming soon" — what stands under the glass */
  blurb: string;
  /** The band at the foot — the page's own materials (optional) */
  foot?: ReactNode;
}

const ComingSoonWall = ({ kicker, blurb, foot }: Props) => {
  /* where the beam falls: the wall's centre against the viewport, re-measured on resize and when the wall resizes (a
     ResizeObserver follows the sidebar's animation) */
  const wallRef = useRef<HTMLDivElement | null>(null);
  const [beamX, setBeamX] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const r = wallRef.current?.getBoundingClientRect();
      if (r) setBeamX(Math.round(r.left + r.width / 2));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (wallRef.current) ro.observe(wallRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, []);
  /* one clock for the flicker: the body animates the value the bulb, beam and wordmark read (index.css room-flicker) */
  useEffect(() => {
    document.body.classList.add('room-walled');
    return () => document.body.classList.remove('room-walled');
  }, []);
  /* The countdown ticks each second while the wall is up */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const countdown = partsTo(OPENS_AT, now);
  /* Notify me — kept in this browser until the service exists */
  const [email, setEmail] = useState('');
  const [noted, setNoted] = useState<string | null>(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY);
    } catch {
      return null;
    }
  });
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const notify = () => {
    if (!emailOk) return;
    const v = email.trim();
    try {
      localStorage.setItem(NOTIFY_KEY, v);
    } catch {
      /* storage off — the note lives for the session */
    }
    setNoted(v);
  };

  return (
    /* no overflow-hidden on the glass: a clipped box becomes the sticky card's scroller and it would ride off with the page */
    /* every wash and light reads a --wall-* token (theme/tokens.css): scrim and silver beam on dark, frost on paper */
    <div ref={wallRef} className="absolute inset-0 z-40 rounded-md" style={{ backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', background: 'var(--wall-scrim)' }} data-room-wall={kicker}>
      {/* the beam: fixed to the viewport top over the wall's centre, on the body so no ancestor clips it (index.css room-beam) */}
      {beamX != null &&
        createPortal(
          <>
            {/* the lamp: cord, cap, glass, filament and glow; the bulb flickers harder than its beam */}
            <div aria-hidden className="fixed top-0 pointer-events-none z-[46]" style={{ left: beamX, transform: 'translateX(-50%)' }} data-room-lamp>
              <div className="room-bulb relative">
                {/* the glow around the glass */}
                <div className="absolute left-1/2 -translate-x-1/2 w-24 h-24 rounded-full blur-md" style={{ top: 28, background: 'var(--wall-glow)' }} />
                <svg width={44} height={80} viewBox="0 0 44 80" className="relative block">
                  <defs>
                    <radialGradient id="room-glass" cx="0.5" cy="0.42" r="0.62">
                      <stop offset="0" stopColor="#ffffff" stopOpacity="0.96" />
                      <stop offset="0.55" stopColor="rgb(var(--wall-light))" stopOpacity="0.62" />
                      <stop offset="1" stopColor="rgb(var(--wall-light))" stopOpacity="0.18" />
                    </radialGradient>
                  </defs>
                  {/* the cord */}
                  <line x1={22} y1={0} x2={22} y2={30} stroke="rgb(var(--wall-light) / 0.4)" strokeWidth={1} />
                  {/* the cap and the neck — a bulb is a bulb, dark on either ground */}
                  <rect x={15} y={30} width={14} height={10} rx={2} fill="#262626" stroke="rgb(var(--wall-light) / 0.3)" strokeWidth={1} />
                  <rect x={17} y={40} width={10} height={4} fill="#1c1c1c" />
                  {/* the glass */}
                  <circle cx={22} cy={58} r={14} fill="url(#room-glass)" stroke="rgb(var(--wall-light) / 0.55)" strokeWidth={1} />
                  {/* the filament */}
                  <path d="M16 57 q3 -7 6 0 t6 0" fill="none" stroke="rgb(var(--wall-filament))" strokeWidth={1.3} strokeLinecap="round" />
                  <line x1={16} y1={57} x2={16} y2={46} stroke="rgb(var(--wall-filament) / 0.7)" strokeWidth={0.8} />
                  <line x1={28} y1={57} x2={28} y2={46} stroke="rgb(var(--wall-filament) / 0.7)" strokeWidth={0.8} />
                </svg>
              </div>
            </div>
            {/* the beam, from the bulb down */}
            <div
              aria-hidden
              className="room-beam fixed w-[560px] h-[62vh] blur-2xl pointer-events-none z-[45]"
              style={{ top: 66, left: beamX, transform: 'translateX(-50%)', background: 'var(--wall-beam)', clipPath: 'polygon(47.5% 0, 52.5% 0, 100% 100%, 0 100%)' }}
              data-room-beam
            />
          </>,
          document.body
        )}
      <div className="sticky top-12 h-[calc(100vh-140px)] min-h-[600px] flex flex-col items-center justify-center overflow-hidden" data-room-wall-card>
        {/* a soft pool behind the words, so they read clean while the page shows at the edges —
            dark on black, white on paper (the theme's --wall-pool) */}
        <div aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[560px] pointer-events-none" style={{ background: 'var(--wall-pool)' }} data-room-wall-pool />
        <div className="relative flex flex-col items-center text-center px-6 animate-soft-in-slow">
          <p className="font-mono text-t9 uppercase tracking-[0.3em] text-textMuted">{kicker}</p>
          {/* pb-2: the holo fill paints only inside the box, and at leading-none the g's tail fell outside it */}
          <h2 className="room-lit mt-2 pb-2 text-t64 font-bold tracking-tight leading-none holo-text paper-galaxy" data-room-wall-title>
            Coming soon
          </h2>
          <p className="mt-5 max-w-lg text-t13 leading-relaxed text-textSecondary">{blurb}</p>
          <p className="mt-9 font-mono text-t9 uppercase tracking-widest text-textMuted">Opens in</p>
          <div className="mt-2 flex items-start gap-3" data-room-countdown>
            {countdown.map(([v, label], i) => (
              <Fragment key={label}>
                <div className="w-16">
                  <div className="font-mono text-t32 font-bold tnum leading-none text-textPrimary">{String(v).padStart(2, '0')}</div>
                  <div className="mt-2 font-mono text-t9 uppercase tracking-widest text-textMuted">{label}</div>
                </div>
                {i < countdown.length - 1 && <span className="font-mono text-t28 leading-none text-textMuted pt-0.5">:</span>}
              </Fragment>
            ))}
          </div>
          <form
            onSubmit={e => {
              e.preventDefault();
              notify();
            }}
            className="mt-9 flex items-center gap-2"
            data-room-notify
          >
            {noted ? (
              <span className="text-t12 text-textSecondary">
                We will write to <span className="font-mono text-textPrimary">{noted}</span> the day it opens.
              </span>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@somewhere.com"
                  className="w-64 h-8 bg-inputBg border border-borderSubtle rounded-md px-3 font-mono text-t12 text-textPrimary placeholder:text-textMuted focus:border-borderMuted outline-none transition-colors"
                  aria-label="Your email"
                />
                <button type="submit" disabled={!emailOk} className="h-8 px-3 rounded-md border border-silver/50 bg-silver/[0.08] font-mono text-t10 uppercase tracking-wider text-silver hover:bg-silver/[0.14] transition-colors disabled:opacity-40 disabled:pointer-events-none">
                  Notify me
                </button>
              </>
            )}
          </form>
          {foot && (
            <div className="mt-12 flex items-center gap-4" aria-hidden>
              {foot}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComingSoonWall;
