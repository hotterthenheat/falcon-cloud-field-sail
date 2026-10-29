/*
  The theme choice (dark, light, system) applied as one `data-theme` attribute on <html>; tokens.css does the rest.
  index.html sets it from the same key before first paint. 'system' follows prefers-color-scheme live.
  readToken() serves canvas and chart code that cannot read var(); useColourVision() sets `data-cvd`.
*/

import { useSyncExternalStore } from 'react';
import { EMBEDDED, EMBED_THEME } from '../embed';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

/** The storage key; index.html's boot script reads it too. */
export const THEME_KEY = 'slayer_theme';

const CHOICES: ThemeChoice[] = ['dark', 'light', 'system'];

function loadChoice(): ThemeChoice {
  /* in the landing's window the page outside names the theme (embed.ts) */
  if (EMBED_THEME) return EMBED_THEME;
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw && (CHOICES as string[]).includes(raw)) return raw as ThemeChoice;
  } catch {
    /* storage blocked: dark */
  }
  return 'dark';
}

const media = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const systemTheme = (): Theme => (media && !media.matches ? 'light' : 'dark');
const resolve = (choice: ThemeChoice): Theme => (choice === 'system' ? systemTheme() : choice);

let choice: ThemeChoice = loadChoice();
let resolved: Theme = resolve(choice);
const listeners = new Set<() => void>();
/** Token colours cached per theme, so a canvas does not query the style engine every frame. */
const tokenCache = new Map<string, string>();

/* Colour vision: 'blue-orange' swaps the direction pair, 'high-contrast' strengthens it (tokens.css). Stored and
   stamped as `data-cvd`; token readers treat a change as a theme change. */
export type ColourVision = 'standard' | 'blue-orange' | 'high-contrast';
export const CVD_KEY = 'slayer_cvd';
function loadCvd(): ColourVision {
  try {
    const kept = localStorage.getItem(CVD_KEY);
    return kept === 'blue-orange' || kept === 'high-contrast' ? kept : 'standard';
  } catch {
    return 'standard';
  }
}
let cvd: ColourVision = loadCvd();

function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  /* the direction pair, on every page */
  if (cvd !== 'standard') root.dataset.cvd = cvd;
  else delete root.dataset.cvd;
  tokenCache.clear();
}

function settle(): void {
  const next = resolve(choice);
  if (next === resolved) return;
  resolved = next;
  apply();
  listeners.forEach(fn => fn());
}

/* re-applies the attribute in case storage and the boot script disagree, and clears the token cache */
apply();
media?.addEventListener('change', () => {
  if (choice === 'system') settle();
});

export const getThemeChoice = (): ThemeChoice => choice;
export const getResolvedTheme = (): Theme => resolved;

export function setThemeChoice(next: ThemeChoice): void {
  if (next === choice) return;
  choice = next;
  /* the landing's window shares the visitor's storage: a tour never rewrites their theme (embed.ts) */
  if (!EMBEDDED) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* non-fatal */
    }
  }
  const before = resolved;
  resolved = resolve(choice);
  apply();
  /* the choice can change while the resolved theme does not (dark to system on a dark machine) */
  listeners.forEach(fn => fn());
  if (before !== resolved) tokenCache.clear();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getColourVision = (): ColourVision => cvd;

/** Swap the direction pair; token readers hear it as a theme change. */
export function setColourVision(next: ColourVision): void {
  if (next === cvd) return;
  cvd = next;
  if (!EMBEDDED) {
    try {
      if (next === 'standard') localStorage.removeItem(CVD_KEY);
      else localStorage.setItem(CVD_KEY, next);
    } catch {
      /* non-fatal: the choice lives for the visit */
    }
  }
  apply();
  cvdListeners.forEach(fn => fn());
  listeners.forEach(fn => fn());
}
const cvdListeners = new Set<() => void>();
const subscribeCvd = (fn: () => void) => {
  cvdListeners.add(fn);
  return () => {
    cvdListeners.delete(fn);
  };
};
export const useColourVision = (): ColourVision => useSyncExternalStore(subscribeCvd, getColourVision, getColourVision);

/** The direction a signed figure carries, for `data-dir` (tokens.css draws the triangles from it). */
export const dirOf = (n: number): 'up' | 'down' | undefined => (n > 0 ? 'up' : n < 0 ? 'down' : undefined);

export const useThemeChoice = (): ThemeChoice => useSyncExternalStore(subscribeTheme, getThemeChoice, getThemeChoice);
export const useResolvedTheme = (): Theme => useSyncExternalStore(subscribeTheme, getResolvedTheme, getResolvedTheme);

/** A token ("--text-muted") as a CSS colour, with optional alpha, for canvas and chart APIs. Read from the
    document by default; pass an element to read inside its theme scope. */
export function readToken(name: string, alpha?: number, from?: Element | null): string {
  const key = `${name}|${alpha ?? ''}|${from ? 'el' : ''}`;
  if (!from) {
    const hit = tokenCache.get(key);
    if (hit) return hit;
  }
  const el = from ?? (typeof document !== 'undefined' ? document.documentElement : null);
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  const channels = raw || '237 237 237';
  const out = alpha == null ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
  if (!from) tokenCache.set(key, out);
  return out;
}
