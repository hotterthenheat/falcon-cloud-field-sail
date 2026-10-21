/*
==================================================
  SLAYER TERMINAL - THE TERMINAL, IN A WINDOW
  (pages/landing/TerminalWindow.tsx)

  The picture on the landing page is the terminal
  itself (Noah, 2026-09-19: "i want the REAL thing
  from our website so it doesnt scream fake").

  IT PLAYS, SINCE 2026-10-01. From 2026-09-19 the
  window held STILLS of the real pages. Then Noah
  saw his partner's landing: "he has actual
  recordings of the page working which is exactly
  what we were missing … we will not be taking his
  actual recording but making our own because we
  have smoother animations when switching pages" —
  and: "recordings in the tour too". So every page
  the tour names is FILMED from the real terminal
  (scripts/make-landing-clips.mjs): a dozen seconds
  of the page in use, nothing over it but a pointer.

  THE STILL STAYS UNDER THE FILM. It is the film's
  own first frame and is on screen at once; the film
  fades in over it when it can play, so the window
  is never empty and the two never jump. The still
  is ALL there is for a visitor who asked for less
  motion or to save data, and where a film cannot be
  played. A film plays only while the window is on
  screen and the tab is in front (films.ts).

  ONE FILM AT A TIME. When the tour asks for another
  page the film on screen holds its frame until the
  next can play, then the next fades in over it.
  When the window turns theme on the same page, the
  other theme's film picks up at the second this one
  had reached, so the turn reads as one motion
  changing its ground.

  WHAT STAYED: the window, its bar saying where it
  is and that the data is simulated, the tour's
  words choosing the picture, the window turning
  theme with the page.

  THE PICTURE'S SHAPE IS FIXED (1440 × 1000 on a
  desk): the window takes that shape (Tour.tsx) and
  a picture is never cropped or stretched there. In
  one column the window is a fixed band and the
  picture fills it from its top left, the way a page
  sits in a window that is shorter than it.
==================================================
*/

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { Theme } from '../../theme/theme';
import Working from '../../components/ui/Working';
import SlayerMark from '../../brand/SlayerMark';
import { FILMS, INTENT_MS, filmFor, filmKey, onThemeIntent, savingData, stillFor, stillOf, useOnScreen, useTabInFront, type Form } from './films';
import Boot, { type Sweep } from './Boot';

/** The desk picture's shape — what scripts/make-landing-clips.mjs films */
export const SHOT_W = 1440;
export const SHOT_H = 1000;
export const SHOT_ASPECT = SHOT_W / SHOT_H;

interface Props {
  /** The page the tour wants shown */
  path: string;
  /** The theme of the ground behind the window */
  theme: Theme;
  /** The landing is laid out for a desk: the desk's picture. Otherwise the terminal's phone layout, or the desk's on a tablet. */
  desk: boolean;
  /** Size the screen by the picture's own shape (a desk). Otherwise the host gives the height. */
  natural?: boolean;
  /** WHAT PLAYS (2026-10-02, the products' pages): the page's own tour film (left out), a film by name — the key the
      film maker made it under, less its theme and form (`pulse-arrange`) — or `false`: the still alone. */
  film?: string | false;
  /** THE LOADING MOMENT (Boot.tsx — his partner's, 2026-10-03): 'switch' — a window that turns from page to page boots
      each new page as it comes (and its first page as the window is first seen): a grain that resolves, along the
      page's own motion (`bootSweep`); the film holds its first frame until the boot has gone. Left out, a page simply
      fades in over the last. */
  boot?: 'switch';
  bootSweep?: Sweep;
  className?: string;
}

/** A film in the window: the one on top is playing (or about to); one under it holds its last frame until the top one can play */
interface Reel {
  key: string;
  path: string;
  theme: Theme;
  form: Form;
  ready: boolean;
}

const crumbs = (pathname: string): string[] => pathname.split('/').filter(Boolean).slice(0, 3);
const pageName = (path: string): string => crumbs(path).join(' ').replace(/-/g, ' ');

/** THE PROMPT (his partner's bar, 2026-10-03): the command that opened the page on screen, typed a letter at a time each
    time the page changes — every letter its own span lit on its own beat (index.css .window-typing), so the typing is
    exact in any face — and the cursor after it on the brand's beat (.window-cursor: the mark's own keyframes, pinned to
    the page's clock by brand/brandClock.ts) */
const Prompt = ({ path }: { path: string }) => {
  const cmd = `open ${crumbs(path).join('/')}`;
  return (
    <span className="min-w-0 flex items-center font-mono text-[11.5px] leading-none whitespace-nowrap" data-window-path={path}>
      <span className="text-textMuted">slayer:~ $</span>
      <span key={cmd} className="window-typing ml-[0.6em] min-w-0 overflow-hidden text-textPrimary" aria-label={cmd}>
        {Array.from(cmd).map((ch, i) => (
          <span key={i} aria-hidden="true" style={{ '--i': i } as CSSProperties}>
            {ch === ' ' ? '\u00a0' : ch}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="window-cursor ml-[2px] shrink-0 w-[2px] h-[1.15em]" />
    </span>
  );
};

const TerminalWindow = ({ path, theme, desk, natural = false, film, boot, bootSweep, className = '' }: Props) => {
  const root = useRef<HTMLDivElement | null>(null);
  const calmRef = useRef(false);
  const view = useRef<HTMLDivElement | null>(null);
  /* a phone's column gets the terminal's phone layout; a tablet's is wide enough for the desk's picture. The first guess
     is the screen's own width (less its gutters), so a phone never fetches the desk's film before it has been measured */
  const [narrow, setNarrow] = useState(() => !desk && typeof window !== 'undefined' && window.innerWidth - 32 < 560);
  useEffect(() => {
    const el = view.current;
    if (!el || desk) return setNarrow(false);
    const measure = () => setNarrow(el.clientWidth < 560);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desk]);
  const form: Form = narrow ? 'phone' : 'desk';

  /* ---- THE STILLS: `shown` is on screen; when the tour asks for another, it is decoded off screen and then laid over ---- */
  /* a named film's still is its own first frame; the page's is the tour's */
  const want = film ? stillOf(`${film}-${theme}-${form}`) : stillFor(path, theme, form);
  const [shown, setShown] = useState<{ src: string; path: string } | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  useEffect(() => {
    if (shown?.src === want) return;
    let alive = true;
    const img = new Image();
    img.src = want;
    const land = () => {
      if (!alive) return;
      setUnder(shown?.src ?? null);
      setShown({ src: want, path });
    };
    img.decode().then(land, land);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);

  /* the other theme's still of this page is fetched ahead: the window turns with the page, and the turn should not wait */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const other = theme === 'dark' ? 'light' : 'dark';
      new Image().src = film ? stillOf(`${film}-${other}-${form}`) : stillFor(path, other, form);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [path, theme, form, film]);
  /* …and its FILM, a little later, into the browser's media cache (a detached element, never shown): the turn then finds
     the other film already in, and the crossfade comes in a few frames instead of a download */
  const warmed = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (film === false || calmRef.current || savingData()) return;
    const t = window.setTimeout(() => {
      const other = theme === 'dark' ? 'light' : 'dark';
      const key = film ? `${film}-${other}-${form}` : filmKey(path, other, form);
      if (FILMS[key] == null) return;
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = filmFor(key);
      warmed.current = v;
    }, 2200);
    return () => {
      window.clearTimeout(t);
      if (warmed.current) {
        warmed.current.removeAttribute('src');
        warmed.current.load();
        warmed.current = null;
      }
    };
  }, [path, theme, form, film]);

  /* ---- THE FILMS ---- */
  const calm = useReducedMotion();
  calmRef.current = !!calm;
  const [frugal] = useState(savingData);
  /* a browser that cannot play them keeps the stills */
  const [cannot, setCannot] = useState(false);
  const key = film ? `${film}-${theme}-${form}` : filmKey(path, theme, form);
  const filmed = film !== false && !calm && !frugal && !cannot && FILMS[key] != null;

  const [reels, setReels] = useState<Reel[]>([]);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    if (!filmed) return setReels([]);
    /* the wanted film is on top; of the rest only the last that could play is kept (it holds the picture while the new
       one loads), and a twin of the other theme (below) rides along */
    setReels(cur => {
      if (cur.some(r => r.key === key)) return cur;
      const under = [...cur].reverse().find(r => r.ready && r.key !== key && r.theme === theme);
      const twins = cur.filter(r => r.theme !== theme && r.path === path && r.form === form);
      return [...(under ? [under] : []), ...twins, { key, path, theme, form, ready: false }];
    });
  }, [key, filmed, path, theme, form]);
  const top = reels.find(r => r.key === key);

  /* THE READER REACHES FOR THE THEME (films.ts themeIntent): the other theme's film of this page is mounted and run
     hidden, in step with the one on screen, for INTENT_MS — so the turn finds it playing and the window turns colour
     with the page (2026-10-03, Noah: the screens "wont change colors as fast as the rest") */
  const [armed, setArmed] = useState(false);
  const armTimer = useRef(0);
  useEffect(() => {
    const off = onThemeIntent(() => {
      if (!filmed) return;
      const other: Theme = theme === 'dark' ? 'light' : 'dark';
      const tk = film ? `${film}-${other}-${form}` : filmKey(path, other, form);
      if (FILMS[tk] == null) return;
      setArmed(true);
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(false), INTENT_MS);
      setReels(cur => (cur.some(r => r.key === tk) ? cur : [...cur, { key: tk, path, theme: other, form, ready: false }]));
    });
    return () => {
      off();
      window.clearTimeout(armTimer.current);
    };
  }, [filmed, theme, path, form, film]);

  const seen = useOnScreen(root, 0.15);
  const front = useTabInFront();
  /* THE BOOT (Boot.tsx): `booting` is the still being booted — a switching window's first page as it is first seen, and
     each new page's as the window turns to it; the film waits on it until the boot has gone */
  const [booting, setBooting] = useState<string | null>(null);
  const firstSeen = useRef(false);
  const lastWant = useRef(want);
  const lastPath = useRef(path);
  useEffect(() => {
    if (boot !== 'switch' || calm || want === lastWant.current) return;
    /* a new PAGE boots; the same page turning theme simply fades to its other picture (a boot on the theme's turn put
       the grain's work on the toggle's own frame — 2026-10-03, the landing's lag) */
    const turned = path !== lastPath.current;
    lastWant.current = want;
    lastPath.current = path;
    if (firstSeen.current && turned) setBooting(want);
  }, [want, path, boot, calm]);
  useEffect(() => {
    if (boot !== 'switch' || calm || !seen || firstSeen.current) return;
    firstSeen.current = true;
    setBooting(lastWant.current);
  }, [seen, boot, calm]);
  const holding = booting !== null;
  const rolling = !!top && seen && front && !holding;

  useEffect(() => {
    for (const r of reels) {
      const v = videos.current.get(r.key);
      if (!v) continue;
      if (r.key === top?.key) {
        if (rolling) v.play().catch(() => {});
        else v.pause();
      } else if (r.theme !== theme) {
        /* the twin of the other theme: runs hidden while the reader reaches for the toggle, in step with the top */
        if (armed && rolling) {
          if (v.paused) {
            const on = top ? videos.current.get(top.key) : undefined;
            if (on && Number.isFinite(on.currentTime) && on.currentTime > 0 && v.duration) v.currentTime = Math.min(on.currentTime, Math.max(0, v.duration - 0.05));
            v.play().catch(() => {});
          }
        } else v.pause();
      } else if (top && !top.ready && rolling) {
        /* the one under, of the same theme (a page's change): it keeps rolling until the new one has drawn */
        v.play().catch(() => {});
      } else v.pause();
    }
  }, [reels, top, rolling, armed, theme]);

  /* THE TURN: the same page in the other theme picks up at the second the last one was at. The time is read when the new
     film's length is known and set again when it can play (a seek asked of a film that cannot yet seek is dropped). */
  const resume = useRef(new Map<string, number>());
  const onLength = useCallback(
    (r: Reel, v: HTMLVideoElement) => {
      const before = reels.find(o => o.key !== r.key && o.path === r.path && o.form === r.form);
      const was = before ? videos.current.get(before.key) : undefined;
      if (!was || !Number.isFinite(was.currentTime) || was.currentTime <= 0) return;
      const t = Math.min(was.currentTime, Math.max(0, v.duration - 0.05));
      resume.current.set(r.key, t);
      v.currentTime = t;
    },
    [reels]
  );
  const onCanPlay = useCallback((r: Reel, v: HTMLVideoElement) => {
    const t = resume.current.get(r.key);
    if (t != null) {
      resume.current.delete(r.key);
      if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
    }
    if (r.ready) return;
    /* it can play: it fades in, and once it has, the one under it (of its own theme) goes; a twin keeps its place */
    setReels(cur => cur.map(o => (o.key === r.key ? { ...o, ready: true } : o)));
    window.setTimeout(() => setReels(cur => (keyRef.current === r.key ? cur.filter(o => o.key === r.key || o.theme !== r.theme) : cur)), 420);
  }, []);

  const here = shown?.path ?? path;
  /* the page on top: a film still loading leaves the one before it on screen, and the prompt waits with it */
  const onTop = [...reels].reverse().find(r => r.ready);
  const drawn = onTop?.path ?? here;

  return (
    <div
      ref={root}
      data-theme={theme}
      data-terminal-window={here}
      data-window-film={reels.length ? (rolling ? 'rolling' : 'held') : 'still'}
      className={`landing-window relative flex flex-col overflow-hidden rounded-[14px] border border-borderMuted bg-canvas text-textPrimary transition-[border-color,box-shadow] duration-500 ${className}`}
    >
      {/* THE BAR — which page this is, and that its numbers are simulated */}
      <div className="shrink-0 h-10 pl-3.5 pr-3.5 flex items-center gap-1.5 sm:gap-3 border-b border-borderSubtle bg-panel font-mono transition-colors duration-500">
        {/* the house mark where the prompt stood (Noah, 2026-09-30: "put the S in the window title bar too") — the bare S|
            since the switch to his partner's logo system (2026-10-03) */}
        <SlayerMark size={16} bare label="" />
        <Prompt path={drawn} />
        <span className="ml-auto text-[9.5px] uppercase tracking-[0.16em] text-textMuted whitespace-nowrap">simulated data</span>
      </div>

      {/* THE SCREEN */}
      <div ref={view} className={`relative overflow-hidden bg-canvas ${natural ? '' : 'flex-1 min-h-0'}`} style={natural ? { aspectRatio: `${SHOT_W} / ${SHOT_H}` } : undefined}>
        {under && <img src={under} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 w-full h-full object-cover object-left-top select-none" />}
        {shown && (
          <img
            key={shown.src}
            src={shown.src}
            alt={`The terminal's ${pageName(shown.path)} page`}
            draggable={false}
            onAnimationEnd={() => setUnder(null)}
            className="absolute inset-0 w-full h-full object-cover object-left-top select-none animate-fade-in"
            data-window-shot={shown.src}
          />
        )}
        {reels.map(r => (
          <video
            key={r.key}
            ref={el => {
              if (el) videos.current.set(r.key, el);
              else videos.current.delete(r.key);
            }}
            src={filmFor(r.key)}
            poster={film ? stillOf(r.key) : stillFor(r.path, r.theme, r.form)}
            muted
            loop
            playsInline
            /* METADATA, NOT THE WHOLE FILM (the speed pass, 2026-10-11): "auto" fetched every reel in full as it mounted —
               a scroll down the landing pulled 17 MB of films. The header alone now; a reel streams when it is told to
               play, and its poster stands until it can. */
            preload="metadata"
            disablePictureInPicture
            aria-label={`The terminal's ${pageName(r.path)} page, in use`}
            onLoadedMetadata={e => onLength(r, e.currentTarget)}
            onCanPlay={e => onCanPlay(r, e.currentTarget)}
            onError={() => setCannot(true)}
            className={`absolute inset-0 w-full h-full object-cover object-left-top select-none transition-opacity duration-200 ${(r.key === top?.key && r.ready) || (r.theme === theme && r.key !== top?.key && r.ready && !top?.ready) ? 'opacity-100' : 'opacity-0'}`}
            data-window-reel={r.key}
          />
        ))}
        {/* the first picture is still travelling: the house's "it is working" mark, and only if the wait lasts (ui/Working.tsx) */}
        {!shown && (
          <span className="absolute inset-x-0 top-0 h-[320px] max-h-full flex items-center justify-center pointer-events-none" data-window-boot>
            <Working label="Loading the picture" stacked />
          </span>
        )}
        {/* the page booting in: the grain resolving along the page's motion, over the still (Boot.tsx) */}
        {booting && (
          <Boot key={`boot:${booting}`} src={booting} sweep={bootSweep} onDone={() => setBooting(b => (b === booting ? null : b))} />
        )}
      </div>
    </div>
  );
};

export default TerminalWindow;
