/*
==================================================
  SLAYER TERMINAL - THE LANDING'S FILMS
  (pages/landing/films.ts)

  What the tour's window and the wall of desks share
  about the films: where they are, which exist, and
  WHEN A FILM MAY PLAY.

  The films are made by scripts/make-landing-clips.mjs
  from the real terminal; films.json is its list — a
  page, theme and size that is not on it has no film,
  and its still is all the landing shows.

  A FILM PLAYS ONLY WHILE IT CAN BE SEEN: its box on
  the screen and the tab in front. And not at all for
  a visitor who asked their system for less motion or
  to save data — they get the still, which is the
  film's own first frame.
==================================================
*/

import { useEffect, useState, type RefObject } from 'react';
import type { Theme } from '../../theme/theme';
import LENGTHS from './films.json';

/** each film's length in seconds, by `<page>-<theme>-<desk|phone>` */
export const FILMS = LENGTHS as Record<string, number>;

export type Form = 'desk' | 'phone';

export const slug = (path: string): string => path.replace(/^\//, '').replace(/\//g, '-');
export const filmKey = (path: string, theme: Theme, form: Form): string => `${slug(path)}-${theme}-${form}`;
export const stillFor = (path: string, theme: Theme, form: Form): string => `/landing/${filmKey(path, theme, form)}.webp`;
/** a film's own first frame, by the film's full key */
export const stillOf = (key: string): string => `/landing/${key}.webp`;
export const filmFor = (key: string): string => `/landing/clips/${key}.mp4`;
/** the wall's small copies: the desk film of a room's first page, 640 wide */
export const wallStill = (path: string, theme: Theme): string => `/landing/wall/${slug(path)}-${theme}.webp`;
export const wallFilm = (path: string, theme: Theme): string => `/landing/wall/${slug(path)}-${theme}.mp4`;

/** a visitor saving data gets the stills */
export const savingData = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!c?.saveData;
};

/** Is the box on the screen? */
export const useOnScreen = (ref: RefObject<Element | null>, share = 0.1): boolean => {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: share });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, share]);
  return seen;
};

/** Is this tab the one in front? */
export const useTabInFront = (): boolean => {
  const [front, setFront] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setFront(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return front;
};

/* THE READER REACHES FOR THE THEME (2026-10-03 — Noah, with the wall's screens circled: they "wont change colors as fast
   as the rest … they lag behind everytime"): the toggle says so as the pointer arrives on it, as a finger lands on it or
   as the keys reach it, and every window with films starts the other theme's film hidden and in step — so by the press
   the other film is already playing, and the screens turn colour with the page. */
const intents = new Set<() => void>();
export const onThemeIntent = (fn: () => void): (() => void) => {
  intents.add(fn);
  return () => {
    intents.delete(fn);
  };
};
export const themeIntent = (): void => intents.forEach(fn => fn());
/** how long the other theme's films are kept playing hidden after the reader reached for the toggle */
export const INTENT_MS = 8000;
