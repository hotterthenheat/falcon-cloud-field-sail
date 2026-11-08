/* palette.ts's names as theme tokens for the DOM (`rgb(var(--…))`), so the light terminal cuts them deep. Canvas and chart options
   cannot read var(), so that code keeps palette.ts's hexes. Never give these a hex-alpha suffix; use `alpha`. */

import { readToken } from '../../theme/theme';

export const BULL = 'rgb(var(--bull))';
const LIME = 'rgb(var(--select))';
/* His walls: the call wall is the green, the put wall is ember. Green and red stay the market's sign. */
export const CALL_WALL = BULL;
export const PUT_WALL = 'rgb(var(--ember))';
export const FLIP = 'rgb(var(--flip))';
export const SUPREME = 'rgb(var(--supreme))';
export const SPOT = 'rgb(var(--text-primary))';
export const FOCUS = LIME;
export const SHORT_GAMMA = 'rgb(var(--bear))';
/* Long gamma, the absorbing book, wears his glacier blue. Short gamma stays red. */
export const LONG_GAMMA = 'rgb(var(--glacier))';
export const ALERT = 'rgb(var(--warn))';
/* The thermal ramp's poles as words: the inks heatLaneInks('thermal-yellow', 0.72) gives the capsules on dark, cut deep on paper. */
export const THERMAL_WARM = 'rgb(var(--thermal-warm))';
export const THERMAL_COOL = 'rgb(var(--thermal-cool))';
/* The silver as a surface (a filled pill with the dark word); as an ink it is `--silver`. */
export const SILVER_FILL = 'rgb(var(--silver-fill))';
/* …and the silver as an ink (a line, a word): deep steel on paper (scripts/silver-ink-proof.mjs) */
export const SILVER = 'rgb(var(--silver))';
/* The clock's pressure pair */
export const EMBER = 'rgb(var(--ember))';
export const GLACIER = 'rgb(var(--glacier))';
/* One sign on the figures is still green and red. The Map's absorb ink is his blue. */
export const AMPLIFY = SHORT_GAMMA;
export const ABSORB = LONG_GAMMA;
/* The pressure pair by palette: ember/glacier on house, the thermal pair on thermal (Settings › Appearance, data/ledgerPalette.ts). */
export const pressureInks = (palette: 'house' | 'thermal'): { absorbs: string; amplifies: string } =>
  palette === 'thermal' ? { absorbs: THERMAL_COOL, amplifies: THERMAL_WARM } : { absorbs: LONG_GAMMA, amplifies: SHORT_GAMMA };
/* Categorical side inks — identity, the same on both grounds (palette.ts) */
export { CALL_SIDE, PUT_SIDE, CHART_MINT } from './palette';

/** An ink at an alpha: a token becomes `rgb(var(--x) / a)` (a hex suffix on a token drops the whole declaration); a hex keeps its suffix. */
export const alpha = (ink: string, a: number): string =>
  ink.startsWith('rgb(var(')
    ? ink.replace(/\)\s*\)$/, `) / ${a})`)
    : ink.startsWith('rgb(')
      ? ink.replace(/\s*\/\s*[\d.]+\s*\)$|\)$/, ` / ${a})`)
      : `${ink}${Math.round(a * 255)
          .toString(16)
          .padStart(2, '0')}`;

/** A token resolved for a canvas or chart option, which cannot read var() (the library paints black). Read off the element whose scope
    should answer; resolve at draw time, since the theme can flip. */
export const resolveInk = (ink: string, from?: Element | null): string => {
  const m = ink.match(/^rgb\(var\((--[\w-]+)\)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  return m ? readToken(m[1], m[2] == null ? undefined : Number(m[2]), from) : ink;
};
