/*
==================================================
  SLAYER TERMINAL - THE WALL OF TOOLS
  (pages/landing/Wall.tsx)

  THE FIRST SCREEN SHOWS THE TOOLS (Noah, 2026-10-01,
  of his partner's landing: "i like the first section
  of the page showcasing all the tools instead of big
  words" — and then: "replace the big window with the
  wall"). Where the hero held one wide window, it
  holds eight small ones: every room of the terminal
  side by side, the way a desk is a wall of screens,
  each playing a short film of the room in use
  (scripts/make-landing-clips.mjs — a small copy of
  the room's own film from the tour, 640 wide).

  Four across and two down on a desk; two across on a
  phone. A screen is a door: it takes the reader to
  that room's words in the tour, where the big window
  plays the same film at its full size.

  IN OUR OWN CLOTHES: the screen is the tour's window
  made small — the same bar, the room's icon
  (ui/PageGlyph.tsx, small), its name, and the tour's
  number for it.

  THE COST. Eight small films play at once, and only
  while the wall is on the screen and the tab is in
  front. Each starts a share further into itself than
  the one before, so the wall never ticks in step. A
  film shows only once it can play — until then, and
  for a visitor who asked for less motion or to save
  data, the screen is its still (films.ts).

  THE TURN OF THE THEME IS INSTANT (2026-10-03 — Noah,
  first: "the actual video recordings are lagging
  when i click the light and dark theme"; then, with
  the screens circled: they "wont change colors as
  fast as the rest … they lag behind everytime").
  Every room keeps a film for EACH theme: the one on
  the ground plays and shows; the other is fetched
  once the wall has settled and waits. When the
  reader reaches for the toggle (films.ts
  themeIntent) the waiting films start, hidden and in
  step with the playing ones, so the press finds them
  already running and the screens turn colour with
  the page. A screen whose other film is not yet
  running turns to the new theme's still at once and
  takes the film as it comes — the colour never lags,
  whatever the film does.
==================================================
*/

import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../../theme/theme';
import { useReducedMotion } from 'framer-motion';
import { useBlockGround } from './ground';
import PageGlyph, { type GlyphName } from '../../components/ui/PageGlyph';
import { INTENT_MS, onThemeIntent, savingData, useOnScreen, useTabInFront, wallFilm, wallStill } from './films';

export interface WallRoom {
  id: string;
  /** the tour's number for it */
  code?: string;
  name: string;
  /** the room's icon (ui/PageGlyph.tsx) */
  glyph?: GlyphName;
  /** the page its film is of */
  path: string;
}

const THEMES: Theme[] = ['dark', 'light'];
/** the fade's length — the films' `transition-opacity duration-200` */
const FADE_MS = 200;

const Wall = ({ rooms, onPick }: { rooms: WallRoom[]; onPick: (id: string) => void }) => {
  const theme = useBlockGround();
  const other: Theme = theme === 'dark' ? 'light' : 'dark';
  const calm = useReducedMotion();
  const [frugal] = useState(savingData);
  /* a screen whose film will not play is its still from then on */
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const filmed = !calm && !frugal;

  const wall = useRef<HTMLDivElement | null>(null);
  const seen = useOnScreen(wall, 0.05);
  const front = useTabInFront();
  const rolling = filmed && seen && front;

  /* the other theme's films and stills are brought in once the wall has settled, so the turn has them in hand */
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      rooms.forEach(r => (new Image().src = wallStill(r.path, other)));
      setWarm(true);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [other, rooms]);

  /* THE READER REACHES FOR THE THEME: for INTENT_MS the other theme's films run hidden, in step with the ones on screen */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let timer = 0;
    const off = onThemeIntent(() => {
      setArmed(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setArmed(false), INTENT_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  const videos = useRef(new Map<string, HTMLVideoElement>());
  /* a film is READY once it has drawn a frame — shown from then if it is the ground's; a hidden twin that is ready is
     what makes the turn instant */
  const [ready, setReady] = useState<Set<string>>(() => new Set());
  const keyOf = (id: string, t: Theme) => `${id}-${t}`;
  /* a film that is running and has a frame */
  const live = (v: HTMLVideoElement | undefined): v is HTMLVideoElement => !!v && !v.paused && v.readyState >= 2 && v.currentTime > 0;
  useEffect(() => {
    const timers: number[] = [];
    for (const r of rooms) {
      for (const t of THEMES) {
        const v = videos.current.get(keyOf(r.id, t));
        if (!v) continue;
        if (t === theme) {
          if (rolling) v.play().catch(() => {});
          else v.pause();
        } else if (armed && warm && rolling) {
          /* the twin, hidden: started in step with the one on screen, left alone once it runs */
          if (v.paused) {
            const on = videos.current.get(keyOf(r.id, theme));
            if (on && Number.isFinite(on.currentTime) && v.duration) v.currentTime = Math.min(on.currentTime, Math.max(0, v.duration - 0.05));
            v.play().catch(() => {});
          }
        } else if (ready.has(keyOf(r.id, t)) && !v.paused) {
          /* the one going out: it rests once its fade is done */
          timers.push(window.setTimeout(() => v.pause(), FADE_MS + 40));
        } else v.pause();
      }
    }
    return () => timers.forEach(t => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, theme, ready, armed, warm, rooms]);

  /* A FILM SHOWS WHEN IT CAN PLAY (a video that has not drawn a frame is a black box over its still). On its first load
     each is sent a share of the way into itself — the fourth a half of the way, and so on — so the wall never ticks in
     step. */
  const sent = useRef(new Set<string>());
  const loaded = (k: string, i: number, on: boolean, v: HTMLVideoElement) => {
    if (sent.current.has(k)) return;
    sent.current.add(k);
    const at = v.duration ? (i / rooms.length) * v.duration : 0;
    if (on && at > 0.05 && Math.abs(v.currentTime - at) > 0.25) v.currentTime = at;
    if (on && rolling) v.play().catch(() => {});
  };
  const playing = (k: string) => setReady(r => (r.has(k) ? r : new Set(r).add(k)));

  /* THE TURN: a film coming in that is already running (the reader reached for the toggle) shows at once; one that is
     not is marked not ready (it fades in as it comes), sent to the outgoing film's moment and played, a few frames apart */
  const was = useRef(theme);
  useEffect(() => {
    if (was.current === theme) return;
    const before = was.current;
    was.current = theme;
    const cold = rooms.filter(r => !live(videos.current.get(keyOf(r.id, theme))));
    if (cold.length) {
      setReady(r => {
        const n = new Set(r);
        cold.forEach(x => n.delete(keyOf(x.id, theme)));
        return n;
      });
    }
    const timers = cold.map((r, i) =>
      window.setTimeout(() => {
        const inV = videos.current.get(keyOf(r.id, theme));
        const outV = videos.current.get(keyOf(r.id, before));
        if (!inV) return;
        if (outV && Number.isFinite(outV.currentTime) && inV.duration) inV.currentTime = Math.min(outV.currentTime, Math.max(0, inV.duration - 0.05));
        if (rolling) inV.play().catch(() => {});
      }, i * 60)
    );
    return () => timers.forEach(t => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return (
    <div ref={wall} className="landing-wall grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3" data-landing-wall data-wall-films={filmed ? (rolling ? 'rolling' : 'held') : 'stills'}>
      {rooms.map((r, i) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.id)}
          aria-label={`${r.name} — see it in the tour`}
          style={{ animationDelay: `${120 + i * 50}ms` }}
          className="landing-screen group relative flex flex-col overflow-hidden rounded-[10px] sm:rounded-[12px] border border-borderMuted bg-canvas text-left text-textPrimary animate-fade-in [animation-fill-mode:both] transition-[transform,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-textPrimary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
          data-wall-room={r.id}
        >
          {/* THE SCREEN'S BAR — the tour window's, made small: the room's icon, its name, its number */}
          <span className="shrink-0 h-6 sm:h-7 px-2 sm:px-2.5 flex items-center gap-1.5 sm:gap-2 border-b border-borderSubtle bg-panel">
            {r.glyph && <PageGlyph name={r.glyph} size={14} className="shrink-0 max-sm:w-3 max-sm:h-3" />}
            <span className="min-w-0 truncate text-[11.5px] sm:text-[12.5px] font-medium">{r.name}</span>
            {r.code && <span className="ml-auto font-mono text-[9.5px] text-textMuted tnum">{r.code}</span>}
          </span>
          {/* THE SCREEN — the still, and the films over it: the one on the ground once it can play, the other across the turn */}
          <span className="relative block w-full aspect-[1440/1000] overflow-hidden bg-canvas">
            <img src={wallStill(r.path, theme)} alt="" aria-hidden="true" draggable={false} decoding="async" className="absolute inset-0 w-full h-full object-cover object-left-top select-none" />
            {filmed &&
              THEMES.map(t => {
                const k = keyOf(r.id, t);
                const on = t === theme;
                if (broken.has(k) || (!on && !warm)) return null;
                /* only the ground's film shows, and only once it has drawn; the other theme's is hidden whatever it does */
                const shown = on && ready.has(k);
                return (
                  <video
                    key={k}
                    ref={el => {
                      if (el) videos.current.set(k, el);
                      else videos.current.delete(k);
                    }}
                    src={wallFilm(r.path, t)}
                    muted
                    loop
                    playsInline
                    /* METADATA, NOT THE WHOLE FILM (the speed pass, 2026-10-11): with "auto" every film on the wall, both
                       themes' worth, was fetched in full before anyone scrolled — 5 MB on the first visit. Now the browser
                       takes the header alone; the film streams when play() is called, which the rolling logic above does
                       only for the theme on screen. The still under it holds the frame meanwhile. */
                    preload="metadata"
                    disablePictureInPicture
                    aria-hidden="true"
                    onLoadedData={e => loaded(k, i, on, e.currentTarget)}
                    onPlaying={() => playing(k)}
                    onError={() => setBroken(b => new Set(b).add(k))}
                    className={`absolute inset-0 w-full h-full object-cover object-left-top select-none transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
                    data-wall-film={k}
                    data-on={on || undefined}
                  />
                );
              })}
          </span>
        </button>
      ))}
    </div>
  );
};

export default Wall;
