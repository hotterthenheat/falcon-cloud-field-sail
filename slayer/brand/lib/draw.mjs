/*
  SLAYER BRAND — THE DRAWING (brand/lib/draw.mjs)

  The mark, the wordmark, the lockups, the page glyphs and the signature as SVG / HTML strings, drawn from the
  terminal's own outlines (generated/source.mjs) and tokens (kit.mjs). Isomorphic and dependency-free.

  Outside the terminal the mark stands on its own: no tile, no corner brackets, no badge. The traced outlines are
  never redrawn, scaled unevenly or recoloured outside the foil, the galaxy ink, and the solid one-colour forms.
  Every element closes explicitly (`<path …></path>`) so the same string is valid HTML, valid SVG and valid XML.
*/
import { MARK, MARK_CONTENT, WORDMARK, GLYPH_DRAW } from './generated/source.mjs';
import { T, SANS } from './kit.mjs';
import { NAV_INK } from './generated/product.mjs';

let n = 0;
/** a document-unique id prefix */
export const uid = p => `${p}${(++n).toString(36)}`;
const f2 = v => +(+v).toFixed(2);
const STOPS = [0, 0.3, 0.55, 0.75, 1];
/* the loading frame: the pan caught bright (brand/iconSvg.ts) */
const FOIL_FAST = ['#FFFFFF', '#DDE8F8', '#F2ECFA', '#FFFFFF', '#E2ECF8'];
const [CX, CY, CW, CH] = MARK.cursor;
const PROMPT_X0 = 11.9;

const gradientEl = (id, colours, attrs = 'x1="0" y1="0" x2="1" y2="1"') =>
  `<linearGradient id="${id}" ${attrs}>${colours.map((c, i) => `<stop offset="${STOPS[i]}" stop-color="${c}"></stop>`).join('')}</linearGradient>`;

const svgOpen = ({ w, h, viewBox, label, style = '', doc = false }) =>
  `<svg${doc ? ' xmlns="http://www.w3.org/2000/svg"' : ''} width="${f2(w)}" height="${f2(h)}" viewBox="${viewBox}" ${
    label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'
  } style="display: block; flex: none; overflow: visible;${style ? ' ' + style : ''}">${doc && label ? `<title>${label}</title>` : ''}`;

/* ── the mark ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** The mark's parts in tile units: `>` (optional), the S in foil, the cursor. Returns { box, defs, body }. */
export function markParts({ theme = 'dark', prompt = true, state = 'idle', solid = null, alertForm = 'cursor' } = {}) {
  const t = T[theme === 'paper' ? 'paper' : 'dark'];
  const id = uid('mk');
  const x0 = prompt ? PROMPT_X0 : MARK_CONTENT.x0;
  const box = [x0, MARK_CONTENT.y0, MARK_CONTENT.x1 - x0, MARK_CONTENT.y1 - MARK_CONTENT.y0];
  const stops = state === 'loading' && theme !== 'paper' ? FOIL_FAST : t.foil;
  const defs = solid ? '' : gradientEl(id, stops);
  const parts = [];
  if (prompt) parts.push(`<path d="${MARK.chevron}" fill="${solid ?? t.prompt}"></path>`);
  parts.push(`<path d="${MARK.s}" fill="${solid ?? `url(#${id})`}"></path>`);
  if (state === 'alert') {
    if (alertForm === 'dot') parts.push(`<circle cx="${CX + CW / 2}" cy="${CY + 3.4}" r="3.4" fill="${solid ?? t.warn}"></circle>`);
    else parts.push(`<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" fill="${solid ?? t.warn}"></rect>`);
  } else if (state !== 'offline') parts.push(`<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" fill="${solid ?? t.lit}"></rect>`);
  return { box, defs, body: parts.join('') };
}

/** The mark, freestanding, `h` px tall: `>S|` from 32 px, `S|` below unless `prompt` says otherwise. */
export function markSvg({ h, theme = 'dark', prompt, state = 'idle', solid = null, label = 'Slayer Terminal', style = '', doc = false, alertForm } = {}) {
  const usePrompt = prompt ?? h >= 32;
  const { box, defs, body } = markParts({ theme, prompt: usePrompt, state, solid, alertForm });
  const w = (h * box[2]) / box[3];
  return `${svgOpen({ w, h, viewBox: box.map(f2).join(' '), label, style, doc })}${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}

/** The retired form — the mark on its 64-unit tile with corner brackets — kept only to show what is no longer used. */
export function tiledMarkSvg({ size, theme = 'dark' } = {}) {
  const t = T[theme === 'paper' ? 'paper' : 'dark'];
  const { defs, body } = markParts({ theme, prompt: true });
  return `${svgOpen({ w: size, h: size, viewBox: '0 0 64 64', label: 'The retired tile form' })}<defs>${defs}</defs><path d="${MARK.tile}" fill="${t.tile}"></path><path d="${MARK.brackets}" fill="none" stroke="${t.bracket}" stroke-width="0.7"></path>${body}</svg>`;
}

/* ── the wordmark ─────────────────────────────────────────────────────────────────────────────────────────── */

/** The wordmark's parts in its own units (0 0 w 48): `>slayer_` lit, `terminal` in the foil, the cursor lit. */
export function wordmarkParts({ theme = 'dark', solid = null, cursor = true, chevron = true } = {}) {
  const t = T[theme === 'paper' ? 'paper' : 'dark'];
  const id = uid('wm');
  const x0 = chevron ? 0 : WORDMARK.cell;
  const w = (cursor ? WORDMARK.width : WORDMARK.textWidth) - x0;
  const defs = solid ? '' : gradientEl(id, t.foil, 'x1="0" y1="0" x2="1" y2="0.35"');
  const lit = solid ?? t.lit;
  const body = [
    chevron ? `<path d="${WORDMARK.chevron}" fill="${lit}"></path>` : '',
    `<path d="${WORDMARK.slayer}" fill="${lit}"></path>`,
    `<path d="${WORDMARK.terminal}" fill="${solid ?? `url(#${id})`}"></path>`,
    cursor ? `<path d="${WORDMARK.cursor}" fill="${lit}"></path>` : '',
  ].join('');
  return { box: [x0, 0, w, WORDMARK.height], defs, body };
}

/** The wordmark `>slayer_terminal`, `h` px tall (ascender to descender), drawn, never set. */
export function wordmarkSvg({ h, theme = 'dark', solid = null, cursor = true, chevron = true, label = 'Slayer Terminal', style = '', doc = false } = {}) {
  const { box, defs, body } = wordmarkParts({ theme, solid, cursor, chevron });
  const w = (h * box[2]) / box[3];
  return `${svgOpen({ w, h, viewBox: box.map(f2).join(' '), label, style, doc })}${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}

/* ── the lockups ──────────────────────────────────────────────────────────────────────────────────────────── */

/*
  Horizontal: the compact symbol S| beside the whole wordmark >slayer_terminal (the wordmark keeps its own prompt, so
  the symbol drops its). Vertical: the symbol over the wordmark. The symbol carries the cursor; the wordmark ends on
  its last letter. Proportions are fixed here and nowhere else — a lockup is never rebuilt by eye.
*/
const LOCKUP = {
  /* in wordmark units (the wordmark box is 48 tall) */
  horizontal: { symH: 78, gap: 46 },
  vertical: { symH: 132, gap: 40 },
};

export function lockupParts({ kind = 'horizontal', theme = 'dark', solid = null, prompt = false } = {}) {
  const wm = wordmarkParts({ theme, solid, cursor: false, chevron: true });
  const mk = markParts({ theme, solid, prompt });
  const L = LOCKUP[kind];
  const s = L.symH / mk.box[3];
  const symW = mk.box[2] * s;
  const wmW = wm.box[2];
  const wmH = wm.box[3];
  const sym = (x, y) => `<g transform="translate(${f2(x)} ${f2(y)}) scale(${f2(s * 1000) / 1000}) translate(${f2(-mk.box[0])} ${f2(-mk.box[1])})">${mk.body}</g>`;
  const word = (x, y) => `<g transform="translate(${f2(x)} ${f2(y)})">${wm.body}</g>`;
  if (kind === 'horizontal') {
    const W = symW + L.gap + wmW;
    const H = L.symH;
    return { box: [0, 0, W, H], defs: mk.defs + wm.defs, body: sym(0, 0) + word(symW + L.gap, (H - wmH) / 2 + 2) };
  }
  const W = Math.max(symW, wmW);
  const H = L.symH + L.gap + wmH;
  return { box: [0, 0, W, H], defs: mk.defs + wm.defs, body: sym((W - symW) / 2, 0) + word((W - wmW) / 2, L.symH + L.gap) };
}

/** A lockup `h` px tall (or `w` px wide). */
export function lockupSvg({ kind = 'horizontal', h, w, theme = 'dark', solid = null, label = 'Slayer Terminal', style = '', doc = false } = {}) {
  const { box, defs, body } = lockupParts({ kind, theme, solid });
  const H = h ?? (w * box[3]) / box[2];
  const W = w ?? (h * box[2]) / box[3];
  return `${svgOpen({ w: W, h: H, viewBox: box.map(f2).join(' '), label, style, doc })}${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}

/* ── the page glyphs (ui/PageGlyph.tsx) ───────────────────────────────────────────────────────────────────── */

const TONE = { dim: 0.5, mid: 0.78, shade: 0.22 };
/** each glyph's coloured part — the room's own ink (PageGlyph's map) */
export const GLYPH_INK = {
  pulse: NAV_INK.pulse,
  terrain: NAV_INK.terrain,
  trace: NAV_INK.trace,
  dossier: NAV_INK.record,
  pinpoint: NAV_INK.pinpoint,
  compass: NAV_INK.compass,
  weigher: NAV_INK.weigher,
  practice: NAV_INK.paperDesk,
  paper: NAV_INK.paperDesk,
  backtest: NAV_INK.backtest,
  journal: NAV_INK.journal,
  community: NAV_INK.community,
  alerts: NAV_INK.alerts,
};
export const GLYPHS = Object.keys(GLYPH_DRAW);

/** A page glyph `size` px square: the body in the house foil (galaxy on paper), its one part in the room's ink. */
export function glyphSvg(name, size, { theme = 'dark', ink = null, solid = null, label = null, style = '', doc = false } = {}) {
  const t = T[theme === 'paper' ? 'paper' : 'dark'];
  const draw = GLYPH_DRAW[name];
  if (!draw) throw new Error(`brand/draw: no glyph "${name}"`);
  const [x0, y0, x1, y1] = draw.box;
  const side = Math.max(x1 - x0, y1 - y0) * 1.04;
  const vx = (x0 + x1) / 2 - side / 2;
  const vy = (y0 + y1) / 2 - side / 2;
  const id = uid('gl');
  const colour = solid ?? ink ?? GLYPH_INK[name];
  const runs = [{ parts: [], cuts: [] }];
  for (const p of draw.parts) {
    const last = runs[runs.length - 1];
    if (p.r === 'x') last.cuts.push(p);
    else if (last.cuts.length) runs.push({ parts: [p], cuts: [] });
    else last.parts.push(p);
  }
  const shape = (p, paint, opacity) =>
    p.w != null
      ? `<path d="${p.d}" fill="none" stroke="${paint}" stroke-width="${p.w}" stroke-linejoin="${p.j ?? 'miter'}" stroke-linecap="${p.cap ?? 'butt'}"${opacity != null ? ` opacity="${opacity}"` : ''}></path>`
      : `<path d="${p.d}" fill="${paint}"${opacity != null ? ` opacity="${opacity}"` : ''}></path>`;
  let body = '';
  const masks = [];
  runs.forEach((run, ri) => {
    const drawn = body + run.parts.map(p => shape(p, p.r === 'i' ? colour : solid ?? `url(#${id}f)`, p.t ? TONE[p.t] : null)).join('');
    if (!run.cuts.length) return void (body = drawn);
    const mid = `${id}m${ri}`;
    masks.push(
      `<mask id="${mid}" maskUnits="userSpaceOnUse" x="${f2(vx)}" y="${f2(vy)}" width="${f2(side)}" height="${f2(side)}"><rect x="${f2(vx)}" y="${f2(vy)}" width="${f2(side)}" height="${f2(side)}" fill="#fff"></rect>${run.cuts
        .map(p => shape(p, '#000'))
        .join('')}</mask>`
    );
    body = `<g mask="url(#${mid})">${drawn}</g>`;
  });
  const grad = solid ? '' : gradientEl(`${id}f`, t.glyph, `gradientUnits="userSpaceOnUse" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"`);
  return `${svgOpen({ w: size, h: size, viewBox: [vx, vy, side, side].map(f2).join(' '), label, style, doc })}<defs>${grad}${masks.join('')}</defs>${body}</svg>`;
}

/* ── foil as CSS, and the signature ───────────────────────────────────────────────────────────────────────── */

/** The S's strip of foil as a CSS gradient (index.css .sm-foil), silver on black and galaxy on paper. */
export const foilCss = (theme = 'dark') => {
  const f = T[theme === 'paper' ? 'paper' : 'dark'].foil;
  return `linear-gradient(115deg, ${f[0]} 0%, ${f[1]} 14%, ${f[2]} 30%, ${f[3]} 46%, ${f[4]} 62%, ${f[2]} 78%, ${f[0]} 100%)`;
};

/** A word in the foil — the landing's "see." — holo on black, galaxy ink on paper. */
export const foilText = (text, theme = 'dark', gradient) =>
  `<span style="background-image: ${gradient}; -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; padding: 0 0.07em; margin: 0 -0.07em">${text}</span>`;

/** The signature `slayer:~ $ ● live` — three words only: live (the foil dot, the silver word), delayed, closed. */
export function signatureHtml({ theme = 'dark', size = 13, state = 'live', rule = true, detail = '' } = {}) {
  const t = T[theme === 'paper' ? 'paper' : 'dark'];
  const dot = state === 'live' ? foilCss(theme) : state === 'delayed' ? t.warn : t.t3;
  const word = state === 'live' ? t.silver : state === 'delayed' ? t.warn : t.t3;
  return `<span style="display: inline-flex; align-items: center; gap: 0.6em; font-family: ${SANS}; font-variant-numeric: tabular-nums; font-size: ${size}px; line-height: 1; white-space: nowrap;${
    rule ? ` padding-bottom: 0.55em; border-bottom: 1px solid ${t.inkA(0.14)};` : ''
  }"><span style="color: ${t.t1}">slayer:~ $</span><span style="display: inline-flex; align-items: center; gap: 0.45em"><span style="display: inline-block; width: 0.5em; height: 0.5em; border-radius: 50%; background: ${dot}"></span><span style="color: ${word}">${state}</span></span>${
    detail ? `<span style="color: ${t.t3}">${detail}</span>` : ''
  }</span>`;
}
