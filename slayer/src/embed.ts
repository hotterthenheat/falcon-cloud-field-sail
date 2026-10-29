/* The seam between the landing's window and the terminal inside it: embedded means framed and asked for with `?embed` (read once).
   Theme from outside, rail folded, no sound, "/" to Pulse; same-origin messages `go`/`theme` in, `ready`/`route`/`escape` out. */

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

