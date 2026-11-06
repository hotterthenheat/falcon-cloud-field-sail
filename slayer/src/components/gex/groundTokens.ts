/* The app's colour tokens (theme/tokens.css) as canvas channels for a chart's GROUND, not the page's: a pane can wear a
   light candle theme on the dark terminal (candleTheme.ts chartGround), so a canvas look reads each token inside a
   hidden `data-theme` scope of that ground — the same block a DOM island on that ground reads, the colour-vision
   variants included. Read at draw time and cached until the theme or the colour vision flips (subscribeTheme). With
   no document (the proofs) the fallback stands, so a draw never fails for want of a token. */

import { subscribeTheme } from '../../theme/theme';

export type Rgb = readonly [number, number, number];

const probes: { light?: HTMLElement; dark?: HTMLElement } = {};
const cache = new Map<string, Rgb>();
let subscribed = false;

function probe(light: boolean): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const key = light ? 'light' : 'dark';
  let el = probes[key];
  if (!el || !el.isConnected) {
    el = document.createElement('span');
    el.setAttribute('data-theme', key);
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    document.body.appendChild(el);
    probes[key] = el;
  }
  if (!subscribed) {
    subscribed = true;
    subscribeTheme(() => cache.clear());
  }
  return el;
}

/** A token's channels ("--glacier") on a light or a dark ground; `fallback` when the page cannot answer */
export function groundToken(name: string, light: boolean, fallback: Rgb): Rgb {
  const key = `${name}|${light ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const el = probe(light);
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  const m = raw.match(/^(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/);
  const out: Rgb = m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : fallback;
  if (el) cache.set(key, out);
  return out;
}

/** Whether a ground (channels) reads as paper: the luma cut every canvas look uses */
export const isLightGround = (g: Rgb): boolean => (0.299 * g[0] + 0.587 * g[1] + 0.114 * g[2]) / 255 > 0.55;
