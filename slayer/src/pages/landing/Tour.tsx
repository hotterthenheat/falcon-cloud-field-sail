/*
  The landing's tour: the words on the left choose the picture in the one window that stays put on the right.
*/

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Arrive } from './pieces';
import TerminalWindow, { SHOT_ASPECT } from './TerminalWindow';
import type { Sweep } from './Boot';
import { OnGround, useGround, type Ground } from './ground';
import { useIsBelowLg } from '../../components/ui/useMediaQuery';
import PageGlyph, { type GlyphName } from '../../components/ui/PageGlyph';

export interface TourRow {
  title: string;
  says: string;
  /** A row with an address is a door: it opens that page in the window */
  path?: string;
}

export interface TourStep {
  id: string;
  /** "01" for a tool; none for the turn */
  code?: string;
  /** The room's icon — its head wears it, small (ui/PageGlyph.tsx) */
  glyph?: GlyphName;
  /** The kind of tool, in a word or two */
  kind: string;
  name: string;
  lead: string;
  /** The lead by the ground the words stand on — the themes room stands on the ground the page turned INTO, so it
      names that one */
  leadFor?: Record<Ground, string>;
  rest: string;
  /** The page the window shows while this step is on screen */
  path: string;
  rows: TourRow[];
  /** the way the window boots into this tool's pages (Boot.tsx) — no two tools alike */
  sweep?: Sweep;
  /** THE TURN: this step opens with the stretch where the ground changes */
  turn?: boolean;
  /** …and what the stretch says at each end of it — one line on the ground it names */
  turnSays?: Record<Ground, string>;
}

interface Props {
  /** The hero — it shares the tour's ground, so the light behind it has no seam */
  head: ReactNode;
  steps: TourStep[];
  /** The page the window shows before any tool's words are on screen */
  first: string;
  onOpen: (path: string) => void;
  /** The ground under the floating bar changed */
  onBarGround: (g: Ground) => void;
  /** The turn back's two lines: the first stands on the far ground, the second on the ground the page opened on */
  endSays: [string, string];
}

/** Where the window's top sits, under the floating bar */
const PIN_TOP = 88;
const PIN_TOP_SMALL = 68;
/** The gutter the window keeps from the viewport's right edge */
const EDGE = 24;
/** The window's own chrome, which keeps its size while the terminal scales: the bar and the two borders */
const CHROME = 42;
/* The pages play themselves: while a tool with several pages is the one on screen, the window turns to the tool's
   next page every DWELL, a silver line filling under the page it is on. */
const DWELL = 6500;

const Tour = ({ head, steps, first, onOpen, onBarGround, endSays }: Props) => {
  const { a, b } = useGround();
  const small = useIsBelowLg();

  const wrap = useRef<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);
  const cell = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const band = useRef<HTMLDivElement | null>(null);
  const bandBack = useRef<HTMLDivElement | null>(null);
  /** the words' column — it crosses the page at the turn, so its travel is measured too */
  const words = useRef<HTMLDivElement | null>(null);
  const stepEls = useRef(new Map<string, HTMLElement>());

  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [turned, setTurned] = useState(false);
  const calm = useReducedMotion();
  /* the one thing that pauses the pages: the pointer over the window */
  const over = useRef(false);
  const elapsed = useRef(0);
  const bar = useRef<HTMLSpanElement | null>(null);
  const activeRef = useRef<string | null>(null);
  const pickedRef = useRef<Record<string, string>>({});
  const pick = useCallback((id: string, path: string) => {
    elapsed.current = 0;
    setPicked(p => ({ ...p, [id]: path }));
  }, []);

  const geo = useRef({ bandMid: Number.POSITIVE_INFINITY, backMid: Number.POSITIVE_INFINITY });
  const state = useRef({ turned: false, bar: false });

  const { scrollY } = useScroll();

  /* Which ground the page is on: the far one between the two turns, home before the first and after the second */
  const place = useCallback(
    (y: number) => {
      const g = geo.current;
      const line = y + window.innerHeight * 0.55;
      const t = line > g.bandMid && line < g.backMid;
      if (t !== state.current.turned) {
        state.current.turned = t;
        setTurned(t);
      }
      const bar = y + 44 > g.bandMid && y + 44 < g.backMid;
      if (bar !== state.current.bar) {
        state.current.bar = bar;
        onBarGround(bar ? b : a);
      }
    },
    [onBarGround, a, b]
  );

  useMotionValueEvent(scrollY, 'change', place);

  /* the visitor flipped the theme: both ends of the journey changed, so say again which one the bar is over */
  useEffect(() => {
    onBarGround(state.current.bar ? b : a);
  }, [a, b, onBarGround]);

  /* THE GEOMETRY, measured — never typed. Runs when the page's width or the tour's height changes. */
  const measure = useCallback(() => {
    const w = wrap.current;
    const g = grid.current;
    const c = cell.current;
    const bd = band.current;
    if (!w || !g || !c || !bd) return;
    const vw = document.documentElement.clientWidth;
    const y = window.scrollY;
    const gr = g.getBoundingClientRect();
    const cs = getComputedStyle(g);
    const heroRight = gr.right - parseFloat(cs.paddingRight);
    const heroLeft = gr.left + parseFloat(cs.paddingLeft);
    /* on a desk the window runs past the column to the viewport's edge */
    c.style.marginRight = small ? '0px' : `${-Math.max(0, vw - EDGE - heroRight)}px`;
    /* this rect is read for its SIZE only: the crossing (below) moves the cell, so where it stands is taken from the
       grid's own layout, never from a rect a transform has shifted */
    const cr = c.getBoundingClientRect();
    /* The window takes the picture's shape: as wide as the cell, its screen SHOT_ASPECT — and where that would be
       taller than the cell, as tall as the cell and narrower, kept against the right edge. A picture is never
       cropped or stretched on a desk. */
    const b0 = box.current;
    if (b0) {
      if (small) b0.style.width = b0.style.height = '';
      else {
        let w1 = cr.width;
        let h1 = CHROME + (w1 - 2) / SHOT_ASPECT;
        if (h1 > cr.height) {
          h1 = cr.height;
          w1 = 2 + (h1 - CHROME) * SHOT_ASPECT;
        }
        b0.style.width = `${w1}px`;
        b0.style.height = `${h1}px`;
      }
    }

    /* THE CROSSING: on the far ground the window stands at the page's LEFT edge and the words in the RIGHT column
       — the mirror of the way in. */
    const wd = words.current;
    if (wd && !small && b0) {
      const gap = parseFloat(cs.columnGap) || 0;
      const wordsW = wd.offsetWidth;
      const cellLeft = heroLeft + wordsW + gap;
      const cellW = Math.max(0, vw - EDGE - cellLeft);
      const boxW = parseFloat(b0.style.width) || cellW;
      w.style.setProperty('--window-travel', `${Math.round(EDGE - cellLeft - (cellW - boxW))}px`);
      w.style.setProperty('--words-travel', `${Math.round(heroRight - wordsW - heroLeft)}px`);
    } else {
      w.style.setProperty('--window-travel', '0px');
      w.style.setProperty('--words-travel', '0px');
    }

    /* the turn is painted over exactly the quiet stretch: its first line stands on the ground it opens on, its last on the other */
    const wTop = w.getBoundingClientRect().top;
    const br = bd.getBoundingClientRect();
    const top = br.top - wTop;
    const end = br.bottom - wTop;
    w.style.setProperty('--band-top', `${Math.round(top)}px`);
    w.style.setProperty('--band-h', `${Math.max(1, Math.round(end - top))}px`);
    /* …and the turn back, the same way */
    const bk = bandBack.current?.getBoundingClientRect();
    const backTop = bk ? bk.top - wTop : 0;
    const backEnd = bk ? bk.bottom - wTop : 0;
    if (bk) {
      w.style.setProperty('--back-top', `${Math.round(backTop)}px`);
      w.style.setProperty('--back-h', `${Math.max(1, Math.round(backEnd - backTop))}px`);
    }

    geo.current = {
      bandMid: wTop + y + top + (end - top) * 0.5,
      backMid: bk ? wTop + y + backTop + (backEnd - backTop) * 0.5 : Number.POSITIVE_INFINITY,
    };
    place(y);
  }, [small, place]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  /* Whose words are on screen: the step crossing one line — half way down a desk, lower on a phone, where the
     window holds the top half. One observer; it fires on a crossing, never on scroll. */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const line = small ? 78 : 50;
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.tourStep ?? null;
          if (e.isIntersecting) setActive(id);
          else if (id === steps[0].id && e.boundingClientRect.top > 0) setActive(cur => (cur === id ? null : cur));
        }
      },
      { rootMargin: `-${line}% 0px -${100 - line - 0.5}% 0px`, threshold: 0 }
    );
    for (const el of stepEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [small, steps]);

  activeRef.current = active;
  pickedRef.current = picked;
  /* a new tool on screen starts its own clock */
  useEffect(() => {
    elapsed.current = 0;
  }, [active]);
  /* THE CLOCK: a frame loop while the window is on screen */
  useEffect(() => {
    const el = cell.current;
    const win = box.current;
    if (!el || !win || calm || typeof IntersectionObserver === 'undefined') return;
    over.current = win.matches(':hover');
    let raf = 0;
    let last = 0;
    let seen = false;
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(100, now - last);
      last = now;
      const s = steps.find(x => x.id === activeRef.current);
      const pages = s ? s.rows.filter(r => r.path).map(r => r.path!) : [];
      const cycles = !!s && pages.length >= 2;
      const holding = !cycles || over.current || document.visibilityState !== 'visible';
      if (!holding) elapsed.current += dt;
      if (cycles && elapsed.current >= DWELL) {
        elapsed.current = 0;
        const cur = pickedRef.current[s!.id] ?? s!.path;
        const next = pages[(Math.max(0, pages.indexOf(cur)) + 1) % pages.length];
        setPicked(p => ({ ...p, [s!.id]: next }));
      }
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, elapsed.current / DWELL)})`;
      if (seen) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        seen = e.isIntersecting;
        if (seen && !raf) {
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.35 }
    );
    /* the pointer over the recording pauses the clock; off it, the clock runs — at once, both ways */
    const enter = () => {
      over.current = true;
    };
    const leave = () => {
      over.current = false;
    };
    io.observe(el);
    win.addEventListener('pointerenter', enter);
    win.addEventListener('pointerleave', leave);
    win.addEventListener('pointercancel', leave);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      win.removeEventListener('pointerenter', enter);
      win.removeEventListener('pointerleave', leave);
      win.removeEventListener('pointercancel', leave);
    };
  }, [calm, steps]);

  const step = steps.find(s => s.id === active);
  const path = step ? picked[step.id] ?? step.path : first;
  const turnAt = steps.findIndex(s => s.turn);

  return (
    <div ref={wrap} className="relative isolate pb-56" data-tour data-tour-active={active ?? 'hero'} data-tour-turned={turned || undefined}>
      {/* `isolate`: the window's layer and its long shadow stay inside the tour — without it the shadow fell on the block below; the foot's
          padding is longer than the shadow's reach, so the next block never cuts it into an edge (both measured) */}
      {/* THE GROUND: one painted gradient for the whole journey, the grain that keeps it from banding,
          the hairline columns and the pool of light the hero stands in */}
      <div aria-hidden="true" className="landing-dawn absolute inset-0 -z-10" data-dir={a === 'dark' ? 'night-day' : 'day-night'}>
        <div className="landing-grain absolute inset-x-0" />
        <div className="landing-grain absolute inset-x-0" data-band="back" />
        <div data-theme={a} className="landing-columns absolute inset-x-0 top-0 h-[1500px]" />
        <div data-theme={a} className="landing-pool absolute inset-x-0 top-0 h-[1700px]" />
      </div>

      <OnGround ground={a}>
        <div data-theme={a} className="text-textPrimary">
          {head}
        </div>
      </OnGround>

      <div ref={grid} id="tools" className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 mt-6 lg:mt-[9vh] lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-x-10 xl:gap-x-12 2xl:gap-x-20 scroll-mt-24">
        {/* THE WINDOW — first in the markup so that, in one column, it pins above the words */}
        <div
          ref={cell}
          className="sticky z-10 self-start lg:col-start-2 lg:row-start-1 h-[50svh] lg:h-[calc(100svh-128px)] lg:max-h-[980px]"
          style={{ top: small ? PIN_TOP_SMALL : PIN_TOP }}
          data-tour-window
        >
          {/* a desk: the box is given the picture's shape (measure), against the cell's right edge. One column: a fixed band the picture fills. */}
          <div ref={box} className={small ? 'h-full' : 'absolute top-0 right-0 w-full h-full'} data-tour-box>
            <TerminalWindow path={path} theme={turned ? b : a} desk={!small} className="h-full" boot="switch" bootSweep={step?.sweep} />
          </div>
          {/* in one column the words pass under the window — they dissolve into it rather than being cut */}
          <div aria-hidden="true" className="lg:hidden pointer-events-none absolute inset-x-0 top-full h-10 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        </div>

        <div ref={words} className="lg:col-start-1 lg:row-start-1 pt-10 lg:pt-0" data-tour-words>
          {steps.map((s, i) => {
            const ground = turnAt >= 0 && i >= turnAt ? b : a;
            const on = active === s.id;
            const shown = picked[s.id] ?? s.path;
            /* a tool with several pages plays them (the clock above): the line under the page on screen says how long until the next */
            const cycles = !calm && s.rows.filter(r => r.path).length >= 2;
            return (
              <article
                key={s.id}
                ref={el => {
                  if (el) stepEls.current.set(s.id, el);
                  else stepEls.current.delete(s.id);
                }}
                data-tour-step={s.id}
                data-theme={ground}
                data-on={on || undefined}
                className="text-textPrimary"
              >
                {/* The turn's quiet stretch: the ground changes and the terminal follows. Two lines, each on the
                    end of the gradient it names, so neither is ever read over the steel in the middle. */}
                {s.turn && (
                  <div ref={band} className="relative h-[96svh] lg:h-[135svh]" data-tour-band>
                    {s.turnSays && (
                      <>
                        <p data-theme={a} className="absolute inset-x-0 top-[6%] max-w-[11ch] text-textPrimary font-light text-t38 lg:text-t52 leading-[1.02] tracking-[-0.04em]">
                          {s.turnSays[a]}
                        </p>
                        <p data-theme={b} className="absolute inset-x-0 bottom-[6%] max-w-[11ch] text-textPrimary font-light text-t38 lg:text-t52 leading-[1.02] tracking-[-0.04em]">
                          {s.turnSays[b]}
                        </p>
                      </>
                    )}
                  </div>
                )}
                <OnGround ground={ground}>
                  {/* the tool on screen is bright and the rest wait */}
                  <div className="min-h-[64svh] lg:min-h-[90svh] pb-16">
                    {/* the step's words arrive as the step comes into view (pieces.tsx Arrive), a line at a time */}
                    <Arrive className={`transition-opacity duration-500 motion-reduce:transition-none ${on || (i === 0 && active === null) ? '' : 'opacity-[0.38]'}`}>
                      <p className="arrive-line [--i:0] flex items-center gap-3 font-mono text-t11 uppercase tracking-[0.22em] text-textMuted">
                        <span className="w-8 h-px bg-textMuted/60" aria-hidden="true" />
                        {s.code && <span className="text-textPrimary tnum">{s.code}</span>}
                        {s.kind}
                      </p>
                      <h3 className="arrive-line arrive-settle [--i:1] mt-5 flex items-center gap-3.5 text-t44 sm:text-t56 lg:text-t50 xl:text-t54 2xl:text-t64 font-light leading-[0.98] tracking-[-0.04em]" data-tour-head>
                        {s.glyph && <PageGlyph name={s.glyph} size={28} className="shrink-0 max-sm:w-6 max-sm:h-6 translate-y-[0.04em]" />}
                        {s.name}
                      </h3>
                      <p className="arrive-line [--i:2] mt-6 max-w-[40ch] text-t17 2xl:text-t18 leading-[1.5]">
                        <span className="font-medium text-textPrimary">{s.leadFor?.[ground] ?? s.lead}</span> <span className="text-textSecondary">{s.rest}</span>
                      </p>
                      <ul className="arrive-line [--i:3] mt-9 border-t border-borderSubtle">
                        {s.rows.map(r => {
                          const here = !!r.path && r.path === shown;
                          const body = (
                            <>
                              <span className={`text-t15 font-medium ${here ? 'text-textPrimary' : r.path ? 'text-textSecondary group-hover:text-textPrimary' : 'text-textPrimary'}`}>{r.title}</span>
                              <span className="mt-1 block text-t135 leading-snug text-textMuted">{r.says}</span>
                            </>
                          );
                          return (
                            <li key={r.title} className="border-b border-borderSubtle">
                              {r.path ? (
                                <button
                                  type="button"
                                  onClick={() => pick(s.id, r.path!)}
                                  aria-pressed={here}
                                  data-tour-row={r.path}
                                  className="group relative w-full text-left py-3.5 pl-4 pr-8 transition-colors hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-silver"
                                >
                                  {/* silver is where you are */}
                                  <span aria-hidden="true" className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-full transition-colors ${here ? 'bg-silver' : 'bg-transparent'}`} />
                                  {body}
                                  <ArrowRight aria-hidden="true" className={`absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition ${here ? 'text-silver' : 'text-textMuted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0'}`} />
                                  {/* The line filling: how long until the next page */}
                                  {on && here && cycles && (
                                    <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-ink/[0.08] overflow-hidden" aria-hidden="true" data-tour-dwell>
                                      <span ref={bar} className="block h-full bg-silver origin-left" style={{ transform: 'scaleX(0)' }} />
                                    </span>
                                  )}
                                </button>
                              ) : (
                                <div className="py-3.5 pl-4 pr-8">{body}</div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <button
                        type="button"
                        onClick={() => onOpen(shown)}
                        /* the door's arrow glides under the pointer, like every door with an arrow on this page (Landing.tsx DOOR_ARROW) */
                        className="group/door mt-8 inline-flex items-center gap-2 h-10 pl-4 pr-3.5 rounded-full border border-borderMuted text-t135 font-medium text-textPrimary hover:border-textPrimary/70 hover:bg-ink/[0.06] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
                        data-tour-door={s.id}
                      >
                        Open {s.turn ? 'the terminal' : s.name}
                        <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/door:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover/door:translate-x-0" aria-hidden="true" />
                      </button>
                    </Arrive>
                  </div>
                </OnGround>
              </article>
            );
          })}
          {/* The turn back: the ground goes home and the terminal with it. The tour's last words stand here, one
              line on each ground. */}
          <div ref={bandBack} className="relative h-[84svh] lg:h-[112svh]" data-tour-band="back">
            <p data-theme={b} className="absolute inset-x-0 top-[6%] max-w-[11ch] text-textPrimary font-light text-t38 lg:text-t52 leading-[1.02] tracking-[-0.04em]">
              {endSays[0]}
            </p>
            <p data-theme={a} className="absolute inset-x-0 bottom-[6%] max-w-[11ch] text-textPrimary font-light text-t38 lg:text-t52 leading-[1.02] tracking-[-0.04em]">
              {endSays[1]}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tour;
