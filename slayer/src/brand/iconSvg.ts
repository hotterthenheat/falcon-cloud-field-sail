/* The mark as still SVG strings for the tab icon and scripts/make-brand-assets.ts. No DOM, literal colours,
   so Node can import it. */

import { MARK, MARK_CONTENT } from './paths';
import type { MarkState } from './markState';

type IconTheme = 'dark' | 'light';

const FOIL: Record<IconTheme, string[]> = {
  dark: ['#eef1f8', '#c2d6f0', '#e4d8f4', '#ffffff', '#c8d8ec'],
  /* the galaxy ink's five stops (tokens.css --foil-1..5 on paper) */
  light: ['#2b2d38', '#66718f', '#23232c', '#675d7e', '#2b2d38'],
};
/* the loading frame: the pan caught bright */
const FOIL_FAST = ['#ffffff', '#dde8f8', '#f2ecfa', '#ffffff', '#e2ecf8'];
const GROUND: Record<IconTheme, { tile: string; edge: string; bracket: string; chevron: string; cursor: string }> = {
  dark: { tile: '#111111', edge: '#1e1f22', bracket: '#3a3d42', chevron: '#6b7077', cursor: '#f4f5f7' },
  light: { tile: '#fbfaf7', edge: '#cdcbc5', bracket: '#8c8a84', chevron: '#6b6e75', cursor: '#0e0f11' },
};

interface MarkSvgOptions {
  state?: MarkState;
  theme?: IconTheme;
  /** The whole 64-unit tile with brackets and ">"; otherwise the S| centred on its tile. */
  full?: boolean;
  /** One colour, no tile: print and mail. */
  solid?: 'black' | 'white';
  /** The maskable icon (also iOS): the tile fills the square, ">S|" inside the middle 80% safe circle. */
  maskable?: boolean;
  /** square corners */
  square?: boolean;
}

/** The mark as an SVG document */
export function markSvg({ state = 'idle', theme = 'dark', full = false, solid, maskable = false, square = false }: MarkSvgOptions = {}): string {
  const g = GROUND[theme];
  let vx = 0;
  let vy = 0;
  let side = 64;
  if (maskable) {
    /* ">S|" spans 11.9 to 51.9, its diagonal inside the middle 80% so any mask keeps it */
    const x0 = 11.9;
    const w = MARK_CONTENT.x1 - x0;
    const h = MARK_CONTENT.y1 - MARK_CONTENT.y0;
    side = Math.hypot(w, h) / 0.78;
    vx = (x0 + MARK_CONTENT.x1) / 2 - side / 2;
    vy = (MARK_CONTENT.y0 + MARK_CONTENT.y1) / 2 - side / 2;
  } else if (!full) {
    side = Math.max(MARK_CONTENT.x1 - MARK_CONTENT.x0, MARK_CONTENT.y1 - MARK_CONTENT.y0) * 1.42;
    vx = (MARK_CONTENT.x0 + MARK_CONTENT.x1) / 2 - side / 2;
    vy = (MARK_CONTENT.y0 + MARK_CONTENT.y1) / 2 - side / 2;
  }
  const r = square || maskable ? 0 : full ? 3 : side * 0.14;
  const stops = state === 'loading' ? FOIL_FAST : FOIL[theme];
  const sFill = solid ? (solid === 'black' ? '#000' : '#fff') : 'url(#f)';
  const showCursor = state !== 'alert' && state !== 'offline';
  const cursorFill = solid ? sFill : g.cursor;
  const [cx, cy, cw, ch] = MARK.cursor;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}">`);
  parts.push('<defs>');
  parts.push(`<linearGradient id="f" x1="0" y1="0" x2="1" y2="1">${stops.map((c, i) => `<stop offset="${[0, 0.3, 0.55, 0.75, 1][i]}" stop-color="${c}"/>`).join('')}</linearGradient>`);
  parts.push('</defs>');
  if (!solid) {
    parts.push(`<rect x="${vx.toFixed(2)}" y="${vy.toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" rx="${r.toFixed(2)}" fill="${g.tile}"/>`);
    if (theme === 'light' && !maskable) {
      parts.push(`<rect x="${(vx + 0.6).toFixed(2)}" y="${(vy + 0.6).toFixed(2)}" width="${(side - 1.2).toFixed(2)}" height="${(side - 1.2).toFixed(2)}" rx="${Math.max(0, r - 0.6).toFixed(2)}" fill="none" stroke="${g.edge}" stroke-width="1.2"/>`);
    }
  }
  if (full && !maskable) parts.push(`<path d="${MARK.brackets}" fill="none" stroke="${solid ? sFill : g.bracket}" stroke-width="0.7"/>`);
  if (full || maskable) parts.push(`<path d="${MARK.chevron}" fill="${solid ? sFill : g.chevron}"/>`);
  parts.push(`<path d="${MARK.s}" fill="${sFill}"/>`);
  if (showCursor) parts.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="${cursorFill}"/>`);
  if (state === 'alert') parts.push(`<circle cx="${cx + cw / 2}" cy="${cy + 3.4}" r="3.4" fill="${theme === 'dark' ? '#ff9500' : '#dc4600'}"/>`);
  parts.push('</svg>');
  return parts.join('');
}

/** The SVG as a data: URL, for a <link rel="icon"> */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;
