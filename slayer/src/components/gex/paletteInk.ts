/*
==================================================
  SLAYER TERMINAL - THE PALETTE, AS TOKENS (components/gex/paletteInk.ts)

  The same names palette.ts exports, as the theme's
  TOKENS for the DOM (2026-09-12): a call wall's
  green, a put wall's red, the flip's grey, the
  supreme's magenta, the alert's orange, spot's
  white — each `rgb(var(--…))`, so the light
  terminal cuts them deep and the dark one keeps
  the originals. Inline styles and SVG attributes
  resolve var(); a canvas and a chart option do not,
  so CHART AND CANVAS CODE KEEPS palette.ts (the
  hexes, which are the dark set the islands wear).
  Never hand one of these a hex-alpha suffix
  (`${ink}1f`) — that is a hex-only trick.
==================================================
*/

import { readToken } from '../../theme/theme';

export const BULL = 'rgb(var(--bull))';
const LIME = 'rgb(var(--select))';
/* THE WALLS ARE MARKERS, NOT SIGNS (the third audit, 2026-10-23: the Map said red for "pushes a move along" and red for
   "put wall"). Green and red are the sign — absorbs and amplifies — everywhere; the walls wear the legs' own inks, the
   call side's glacier and the put side's ember (CALL_SIDE / PUT_SIDE), so a wall marker never reads as a sign. */
export const CALL_WALL = 'rgb(var(--glacier))';
export const PUT_WALL = 'rgb(var(--ember))';
export const FLIP = 'rgb(var(--flip))';
export const SUPREME = 'rgb(var(--supreme))';
export const SPOT = 'rgb(var(--text-primary))';
export const FOCUS = LIME;
export const SHORT_GAMMA = 'rgb(var(--bear))';
export const LONG_GAMMA = BULL;
export const ALERT = 'rgb(var(--warn))';
/* THE THERMAL RAMP'S POLES AS WORDS (breaks / pushes along · a shelf / pushes
   back) — the same inks heatLaneInks('thermal-yellow', 0.72) computes for the
   capsules on the dark terminal, cut deep on paper (tokens.css) */
export const THERMAL_WARM = 'rgb(var(--thermal-warm))';
export const THERMAL_COOL = 'rgb(var(--thermal-cool))';
/* THE SILVER AS A SURFACE — a filled pill with the dark word on it, the holo
   family's flat form on either ground (the silver as an INK is `--silver`) */
export const SILVER_FILL = 'rgb(var(--silver-fill))';
/* The clock's pressure pair */
export const EMBER = 'rgb(var(--ember))';
export const GLACIER = 'rgb(var(--glacier))';
/* ONE PAIR FOR HEDGING'S TWO SIDES ACROSS THE MAP (the partner's rule, taken 2026-10-14: "one colour code across all
   views"): the capsules and the bars said amplify in ember and absorb in glacier while the profile, the book through
   the day and the facts said the same two things in red and green — the inks of the walls and of direction. The Map's
   boxes read these; SHORT_GAMMA and LONG_GAMMA stay for the rooms that always wore them. */
/* ONE SIGN RULE (the third audit, 2026-10-23): absorbs green, amplifies red, on the Map as on the Board, the gamma line
   and every net figure — the ember/glacier pair is the legs' and the walls' now */
export const AMPLIFY = SHORT_GAMMA;
export const ABSORB = LONG_GAMMA;
/* THE PRESSURE PAIR BY PALETTE (Noah, 2026-10-17, the clock's strip in ember and glacier beside a thermal book: "the
   color of this needs to change to match the thermal"): amplify and absorb in the two inks the book's legend wears —
   ember and glacier on the house palette, the thermal pair on thermal (Settings › Appearance, data/ledgerPalette.ts) */
export const pressureInks = (palette: 'house' | 'thermal'): { absorbs: string; amplifies: string } =>
  palette === 'thermal' ? { absorbs: THERMAL_COOL, amplifies: THERMAL_WARM } : { absorbs: LONG_GAMMA, amplifies: SHORT_GAMMA };
/* Categorical side inks — identity, the same on both grounds (palette.ts) */
export {  } from './palette';

/** An ink at an alpha. The hex trick (`${ink}55`) breaks on a token — the
    string becomes `rgb(var(--x))55`, the whole declaration is dropped and the
    wash or the glow silently vanishes (the wall beam's fill, 2026-09-12). A
    token becomes `rgb(var(--x) / a)`; a hex keeps its two-digit suffix. */
export const alpha = (ink: string, a: number): string =>
  ink.startsWith('rgb(var(')
    ? ink.replace(/\)\s*\)$/, `) / ${a})`)
    : ink.startsWith('rgb(')
      ? ink.replace(/\s*\/\s*[\d.]+\s*\)$|\)$/, ` / ${a})`)
      : `${ink}${Math.round(a * 255)
          .toString(16)
          .padStart(2, '0')}`;

/** A token ink resolved for a CANVAS or a CHART OPTION, which cannot read
    var() — handed one, the chart library paints black (the Compare tape's
    leader line, invisible on the dark terminal, 2026-09-12). Read off the
    element whose scope should answer (a dark island resolves to the dark
    set); a hex or a resolved rgb() passes through. Resolve at draw time, not
    at module load: the theme can flip. */
export const resolveInk = (ink: string, from?: Element | null): string => {
  const m = ink.match(/^rgb\(var\((--[\w-]+)\)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  return m ? readToken(m[1], m[2] == null ? undefined : Number(m[2]), from) : ink;
};
