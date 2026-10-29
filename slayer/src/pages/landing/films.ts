/* What the tour's window and the wall share about the films (made by scripts/make-landing-clips.mjs, listed in films.json).
   A film plays only while on screen with the tab in front, never under reduced motion or save-data (the still is its first frame). */

import { useEffect, useState, type RefObject } from 'react';
import type { Theme } from '../../theme/theme';
import LENGTHS from './films.json';

/** each film's length in seconds, by `<page>-<theme>-<desk|phone>` */
export const FILMS = LENGTHS as Record<string, number>;

export type Form = 'desk' | 'phone';

const slug = (path: string): string => path.replace(/^\//, '').replace(/\//g, '-');
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

/* Theme intent: as the pointer, a finger or the keys reach the toggle, every window starts the other theme's film hidden and in step,
   so the screens turn with the page. */
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
