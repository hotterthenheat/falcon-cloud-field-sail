/*
  The seam between the landing's window and the terminal loaded inside it. A page is EMBEDDED when it runs in a frame
  and was asked for with `?embed`; read once at load, so it survives navigation inside the frame. Embedded, the theme
  comes from outside and is never stored, the rail opens folded, there is no sound, and "/" goes to Pulse.
  Data is whatever the visitor's session allows: signed out, the paid feeds stay closed (data/feedGate.ts).
  Messages (same origin only): out to in `go {path}`, `theme {theme}`; in to out `ready`, `route`, `escape` {path}.
*/

import type { Theme } from './theme/theme';

const inFrame = (() => {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

/** True for the whole life of a document loaded into the landing's window. */
export const EMBEDDED: boolean = inFrame && !!params?.has('embed');
/** `&photo=1` as well: scripts/make-landing-clips.mjs pictures pages in use on a throwaway paper account that is never
    read from or written to storage (data/paper/store.ts). The landing itself never asks for it. */
export const PHOTO: boolean = EMBEDDED && !!params?.has('photo');

const asked = params?.get('theme');
/** The theme the outer page asked for; index.html reads the same parameter for the first paint. */
export const EMBED_THEME: Theme | null = EMBEDDED && (asked === 'light' || asked === 'dark') ? asked : null;

export type ToEmbed = { slayer: 'landing'; type: 'go'; path: string } | { slayer: 'landing'; type: 'theme'; theme: Theme };
export type FromEmbed = { slayer: 'embed'; type: 'ready' | 'route' | 'escape'; path: string };

/** The address a window loads first. */
export const embedSrc = (path: string, theme: Theme): string => `${path}${path.includes('?') ? '&' : '?'}embed=1&theme=${theme}`;
